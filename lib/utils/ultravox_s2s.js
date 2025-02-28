const Emitter = require('events');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Static counter for all instances of Adaptor class
let instanceCounter = 0;

/**
 * Adaptor for Ultravox API - handles pcm audio streaming between jambonz and Ultravox
 * *
 * *  N.B.: Not working yet.  Ultravox does not seem to obey the prompts very well
 * *  and consistently badgers the speaker to say something.  It also greets
 * *  the user at the start which is not what we want.
 * *
 * @extends Emitter
 * @emits Adaptor#audio - raw pcm audio that can be streamed back to jambonz
 *
 * @param {Object} logger - logger instance
 * @param {String} api_key - Ultravox API key
 * @param {String} prompt - Initial instructions/prompt
 * @param {String} model - Ultravox model to use (default: 'fixie-ai/ultravox')
 * @param {String} voice - Voice to use (default: 'Tanya-English')
 */
class Adaptor extends Emitter {
  constructor(logger, api_key, prompt, model = 'fixie-ai/ultravox', voice = 'Tanya-English') {
    super();
    this.logger = logger;
    this.api_key = api_key;
    this.prompt = prompt;
    this.model = model;
    this.voice = voice;
    this.joinUrl = null;
    this.initialized = false;
    this.errored = false;

    this.enableFileLogging = process.env.DEBUG_AUDIO_FILE === 'true';
    if (this.enableFileLogging) {
      // Assign unique instance ID for file naming
      this.instanceId = ++instanceCounter;

      // Create temp file paths for storing incoming and outgoing audio for debugging
      this.incomingAudioFilePath = path.join(os.tmpdir(), `jambonz-in-audio-ultravox-${this.instanceId}.raw`);
      this.outgoingAudioFilePath = path.join(os.tmpdir(), `ultravox-out-audio-${this.instanceId}.raw`);

      this.logger.info(`Audio debugging enabled, will log incoming audio to: ${this.incomingAudioFilePath}`);
      this.logger.info(`Audio debugging enabled, will log outgoing audio to: ${this.outgoingAudioFilePath}`);

      // Clear the files
      fs.writeFileSync(this.incomingAudioFilePath, Buffer.alloc(0));
      fs.writeFileSync(this.outgoingAudioFilePath, Buffer.alloc(0));
    }

    // Add default error handler to prevent crashes
    this.on('error', (err) => {
      this.errored = true;
      this.logger.error({err: err.message}, 'Ultravox adapter error caught by default handler');
    });

    // Start the connection process
    this._safeInitialize();
  }

  async _safeInitialize() {
    try {
      await this._initializeConnection();
    } catch (err) {
      this.errored = true;
      this.logger.error({err: err.message, stack: err.stack}, 'Failed in _safeInitialize');
      // Do not emit or throw errors here
    }
  }

  async _initializeConnection() {
    try {
      // First create a call to get the joinUrl
      const callData = await this._createCall();

      // Check if there was an error during call creation
      if (callData.error) {
        this.errored = true;
        this.logger.error({ message: callData.message }, 'Failed to create Ultravox call');
        return; // Don't emit error, just log and return
      }

      if (!callData.joinUrl) {
        this.errored = true;
        const errorMsg = 'No joinUrl returned from Ultravox API';
        this.logger.error({ callData }, errorMsg);
        return; // Don't emit error, just log and return
      }

      this.joinUrl = callData.joinUrl;

      // Then connect to the WebSocket
      this._connect();
      this.initialized = true;
    } catch (err) {
      this.errored = true;
      // Just log the error, but don't emit or throw
      this.logger.error({
        errorMessage: err.message,
        stack: err.stack
      }, 'Failed to initialize Ultravox connection');
    }
  }

  async _createCall() {
    try {
      const payload = {
        systemPrompt: this.prompt,
        model: this.model,
        voice: this.voice,
        medium: {
          serverWebSocket: {
            inputSampleRate: 8000,
            outputSampleRate: 8000,
          }
        }
      };

      // Using axios for HTTP requests
      const axios = require('axios');

      this.logger.debug({ payload }, 'Sending request to Ultravox API');

      let response;
      try {
        response = await axios.post('https://api.ultravox.ai/api/calls', payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.api_key
          }
        });
      } catch (axiosError) {
        // Handle axios-specific errors
        const errorDetails = {
          message: axiosError.message,
          status: axiosError.response?.status,
          responseData: axiosError.response?.data,
          url: axiosError.config?.url
        };

        this.logger.error({ error: errorDetails }, 'Axios error when creating Ultravox call');

        // Special handling for 402 Payment Required errors
        if (axiosError.response?.status === 402) {
          this.logger.error('Ultravox subscription issue: Payment required');
          return {
            error: true,
            message: `Ultravox subscription issue: Payment required. ${(axiosError.response?.data?.detail || '')}`
          };
        }

        return { error: true, message: `Failed to create Ultravox call: ${axiosError.message}` };
      }

      // Validate response
      if (!response || response.status !== 201 || !response.data?.joinUrl) {
        // eslint-disable-next-line max-len
        const errorMsg = `Ultravox Error: Invalid response ${response?.status || 'unknown'}: ${response?.data?.message || 'No valid joinUrl'}`;
        this.logger.error({
          statusCode: response?.status,
          responseData: response?.data
        }, errorMsg);
        return { error: true, message: errorMsg };
      }

      const data = response.data;
      this.logger.info({ joinUrl: data.joinUrl }, 'Ultravox Call registered');
      return data;
    } catch (error) {
      this.logger.error({
        errorMessage: error.message,
        stack: error.stack
      }, 'Error creating Ultravox call');

      // Return a failed state that the class can handle
      return { error: true, message: error.message };
    }
  }

  setIncomingJambonzSocket(ws) {
    // Check if we're in an error state before setting up socket
    if (this.errored) {
      this.logger.warn('Not setting up incoming socket - adapter is in error state');
      return;
    }

    ws
      .on('message', (message, isBinary) => {
        // send audio data to Ultravox
        if (isBinary && this.ws && this.ws.readyState === WebSocket.OPEN) {
          if (this.enableFileLogging) {
            fs.appendFileSync(this.incomingAudioFilePath, message);
            this.logger.debug(`Wrote ${message.length} bytes from Jambonz to ${this.incomingAudioFilePath}`);
          }

          // No need to base64 encode for Ultravox - send raw PCM audio
          this.ws.send(message);
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
    this.logger.info('Closing Ultravox connection');
    this.ws?.close();

    if (this.enableFileLogging) {
      this.logger.info(`Jambonz incoming audio saved to: ${this.incomingAudioFilePath}`);
      this.logger.info(`Ultravox outgoing audio saved to: ${this.outgoingAudioFilePath}`);
    }
  }

  _connect() {
    if (!this.joinUrl) {
      this.logger.error('Cannot connect to Ultravox: No joinUrl available');
      return;
    }

    this.logger.info({ joinUrl: this.joinUrl }, 'Connecting to Ultravox WebSocket');
    try {
      this.ws = new WebSocket(this.joinUrl);

      this.ws
        .on('open', this._onOpen.bind(this))
        .on('error', this._onError.bind(this))
        .on('close', this._onClose.bind(this))
        .on('message', this._onServerEvent.bind(this));
    } catch (err) {
      this.logger.error({ err }, 'Error creating WebSocket connection');
      // Don't throw or emit, just log
    }
  }

  _onOpen() {
    this.logger.info('Ultravox WebSocket connection open');
    // No need to send an initial message - already configured in createCall
  }

  _onClose(code, reason) {
    this.logger.info({ code, reason }, 'Ultravox disconnected');
    // Don't emit close, just log
  }

  _onError(err) {
    this.logger.info({ err }, 'Ultravox WebSocket error');
    // Don't emit error, just log
  }

  _onServerEvent(message, isBinary) {
    if (isBinary) {
      // This is audio data from Ultravox
      if (this.enableFileLogging) {
        fs.appendFileSync(this.outgoingAudioFilePath, message);
        this.logger.debug(`Wrote ${message.length} bytes from Ultravox to ${this.outgoingAudioFilePath}`);
      }

      // Forward to Jambonz
      if (this.ws_jambonz_out && this.ws_jambonz_out.readyState === WebSocket.OPEN) {
        this.ws_jambonz_out.send(message);
      }
    } else {
      // This is a JSON control message
      try {
        const msg = JSON.parse(message);
        this.logger.debug({ msg }, 'Ultravox server event message');

        // Handle any specific Ultravox control messages here if needed
      } catch (error) {
        this.logger.error({ error, message }, 'Error parsing Ultravox message');
      }
    }
  }

  // Public method to check if adapter is in a working state
  isHealthy() {
    return this.initialized && !this.errored && this.ws?.readyState === WebSocket.OPEN;
  }
}

module.exports = Adaptor;
