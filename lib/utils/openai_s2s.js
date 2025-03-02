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
    this.connectionEstablished = false;
    this.isClosed = false;

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
        if (isBinary && this.ws && this.ws.readyState === WebSocket.OPEN) {
          if (this.enableFileLogging) {
            fs.appendFileSync(this.incomingAudioFilePath, message);
            this.logger.debug(`Wrote ${message.length} bytes from Jambonz to ${this.incomingAudioFilePath}`);
          }
          // Convert binary audio to Base64 as required by OpenAI Realtime API
          const base64Chunk = message.toString('base64');

          // Send the Base64 encoded audio to OpenAI with the required format
          try {
            this.ws.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: base64Chunk
            }));
          } catch (err) {
            this.logger.error({ err }, 'Error sending audio to OpenAI');
          }
        }
      })
      .on('close', () => {
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
    if (this.isClosed) {
      return;
    }
    
    this.isClosed = true;
    this.logger.info('Closing OpenAI connection');

    if (this.enableFileLogging) {
      this.logger.info(`Jambonz incoming audio saved to: ${this.incomingAudioFilePath}`);
      this.logger.info(`OpenAI outgoing audio saved to: ${this.outgoingAudioFilePath}`);
    }

    // Only close the WebSocket if it exists and isn't already closed
    if (this.ws) {
      try {
        // Check if the connection was ever established
        if (!this.connectionEstablished) {
          this.logger.info('WebSocket connection was never established, not calling close()');
          this.ws = null;
          return;
        }
        
        // Only close if the WebSocket is not already closing or closed
        if (this.ws.readyState !== WebSocket.CLOSING && this.ws.readyState !== WebSocket.CLOSED) {
          this.ws.close();
        }
      } catch (err) {
        this.logger.error({ err }, 'Error closing OpenAI WebSocket');
      } finally {
        this.ws = null;
      }
    }
  }

  _connect() {
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
    try {
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.api_key}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.ws
        .on('open', () => {
          this.connectionEstablished = true;
          this._onOpen();
        })
        .on('error', this._onError.bind(this))
        .on('close', this._onClose.bind(this))
        .on('message', this._onServerEvent.bind(this));
    } catch (err) {
      this.logger.error({ err }, 'Error creating OpenAI WebSocket');
      this.emit('error', err);
    }
  }

  _sendInitialUpdate() {
    if (!this._updateSent && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._updateSent = true;
      try {
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
      } catch (err) {
        this.logger.error({ err }, 'Error sending initial update to OpenAI');
      }
    }
  }

  _onOpen() {
    this.logger.info('OpenAI connection open, sending response.create');
  }

  _onConnect() {
    this.logger.info('Connected to OpenAI');
    this._sendInitialMessage();
  }

  _onClose() {
    if (!this.isClosed) {
      this.logger.info('OpenAI disconnected from us');
      this.emit('close');
    }
    this.ws = null;
  }

  _onError(err) {
    this.logger.info({ err }, 'OpenAI error');
    
    // Don't emit error if we're already closed or closing
    if (!this.isClosed) {
      this.emit('error', err);
    }
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
      try {
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
      } catch (err) {
        this.logger.error({ err, message }, 'Error processing server event');
      }
    }
  }
}

module.exports = Adaptor;
