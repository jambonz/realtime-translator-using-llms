const Emitter = require('events');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Static counter for all instances of Adaptor class
let instanceCounter = 0;

/**
 * Adaptor for OpenAI API - converts pcm audio from jambonz to base64 encoded for OpenAI and vice versa
 * @extends Emitter
 * @emits Adaptor#audio - raw pcm audio that can be streamed back to jambonz
 *
 * @param {Object} logger - logger instance
 * @param {String} api_key - OpenAI
 *
 */
class Adaptor extends Emitter {
  constructor(logger, api_key, prompt) {
    super();
    this.logger = logger;
    this.api_key = api_key;
    this.prompt = prompt;

    this.enableFileLogging = process.env.DEBUG_AUDIO_FILE === 'true';
    if (this.enableFileLogging) {
      // Assign unique instance ID for file naming
      this.instanceId = ++instanceCounter;

      // Create temp file paths for storing incoming and outgoing audio for debugging
      this.incomingAudioFilePath = path.join(os.tmpdir(), `jambonz-in-audio-${this.instanceId}.raw`);
      this.outgoingAudioFilePath = path.join(os.tmpdir(), `openai-out-audio-${this.instanceId}.raw`);

      this.logger.info(`Audio debugging enabled, will log incoming audio to: ${this.incomingAudioFilePath}`);
      this.logger.info(`Audio debugging enabled, will log outgoing audio to: ${this.outgoingAudioFilePath}`);

      // Clear the files
      fs.writeFileSync(this.incomingAudioFilePath, Buffer.alloc(0));
      fs.writeFileSync(this.outgoingAudioFilePath, Buffer.alloc(0));
    }

    this._connect(prompt);
  }

  setIncomingJambonzSocket(ws) {
    ws
      .on('message', (message, isBinary) => {
        // send audio data to OpenAI
        if (isBinary && this.ws.readyState === WebSocket.OPEN) {
          if (this.enableFileLogging) {
            fs.appendFileSync(this.incomingAudioFilePath, message);
            this.logger.debug(`Wrote ${message.length} bytes from Jambonz to ${this.incomingAudioFilePath}`);
          }
          // Convert binary audio to Base64 as required by OpenAI Realtime API
          const base64Chunk = message.toString('base64');

          // Send the Base64 encoded audio to OpenAI with the required format
          this.ws.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64Chunk
          }));
        }
      })
      .on('close', () => {
        this.logger.info('Jambonz socket closed');
        this.close();
      })
      .on('error', (err) => {
        this.logger.info({ err }, 'Jambonz socket error');
        this.close();
      });
  }

  setOutgoingJambonzSocket(ws) {
    this.ws_jambonz_out = ws;
  }

  close() {
    this.logger.info('Closing OpenAI connection');
    this.ws?.close();

    if (this.enableFileLogging) {
      this.logger.info(`Jambonz incoming audio saved to: ${this.incomingAudioFilePath}`);
      this.logger.info(`OpenAI outgoing audio saved to: ${this.outgoingAudioFilePath}`);
    }
  }

  _connect() {
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.api_key}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    this.ws
      .on('open', this._onOpen.bind(this))
      .on('error', this._onError.bind(this))
      .on('close', this._onClose.bind(this))
      .on('message', this._onServerEvent.bind(this));
  }

  _sendInitialMessage() {
    this.logger.info(`Sending instructions message to OpenAI: ${this.prompt}`);
    /*
    this.ws.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['audio', 'text'],
        instructions: this.prompt,
        voice: 'alloy',
        output_audio_format: 'pcm16',
      }
    }));
    */
  }

  _sendInitialUpdate() {
    if (!this._updateSent) {
      this._updateSent = true;
      this.ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'],
          instructions: this.prompt,
          input_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1',
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.8,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          }
        }
      }));
    }
  }

  _onOpen() {
    this.logger.info('OpenAI connection open, sending response.create');
    this._sendInitialMessage();
  }

  _onConnect() {
    this.logger.info('Connected to OpenAI');
    this._sendInitialMessage();
  }

  _onClose() {
    this.logger.info('OpenAI disconnected from us');
    this.emit('close');
    this.close();
  }

  _onError(err) {
    this.logger.info({ err }, 'OpenAI error');
    this.emit('error', err);
  }

  _processAudio(base64AudioData) {
    try {
      // Decode the base64 string back to raw 24kHz PCM buffer
      const audioBuffer = Buffer.from(base64AudioData, 'base64');

      if (this.enableFileLogging) {
        // Append the decoded audio to the OpenAI outgoing file
        fs.appendFileSync(this.outgoingAudioFilePath, audioBuffer);
        this.logger.debug(`Wrote ${audioBuffer.length} bytes from OpenAI to ${this.outgoingAudioFilePath}`);
      }

      // Send to jambonz socket if available
      if (this.ws_jambonz_out && this.ws_jambonz_out.readyState === WebSocket.OPEN) {
        this.ws_jambonz_out.send(audioBuffer);
      }

    } catch (error) {
      this.logger.error({ error }, 'Error processing audio data');
    }
  }

  _onServerEvent(message, isBinary) {
    if (!isBinary) {
      const msg = JSON.parse(message);
      switch (msg.type) {
        case 'session.created':
          this._sendInitialUpdate();
          break;
        case 'response.audio.delta':
          this._processAudio(msg.delta);
          break;
        case 'response.audio_transcript.delta':
          break;
        default:
          this.logger.info({msg}, 'OpenAI server event message');
          break;
      }
    }
  }
}

module.exports = Adaptor;
