const assert = require('assert');
const OpenAIAdapter = require('./openai_s2s');
const UltravoxAdapter = require('./ultravox_s2s');
const {AI_PROMPT_CALLING_PARTY, AI_PROMPT_CALLED_PARTY} = require('./get-prompts');

/**
 * The Switchman class is responsible for switching audio from the jambonz tracks onto the
 * LLM tracks and vice versa for a single conversation
 *
 */
class Switchman {
  constructor(logger, call_sid) {
    this.logger = logger;
    this.call_sid_a = call_sid;
    this.call_sid_b = null;
  }

  addJambonzWebsocket(ws, call_sid) {
    if (call_sid === this.call_sid_a) {
      // get our openai connections open immediately when the call starts
      if (process.env.OPENAI_API_KEY) {
        this.a_adapter = new OpenAIAdapter(this.logger, process.env.OPENAI_API_KEY, AI_PROMPT_CALLING_PARTY);
        this.b_adapter = new OpenAIAdapter(this.logger, process.env.OPENAI_API_KEY, AI_PROMPT_CALLED_PARTY);
      }
      else if (process.env.ULTRAVOX_API_KEY) {
        this.a_adapter = new UltravoxAdapter(this.logger, process.env.ULTRAVOX_API_KEY, AI_PROMPT_CALLING_PARTY);
        this.b_adapter = new UltravoxAdapter(this.logger, process.env.ULTRAVOX_API_KEY, AI_PROMPT_CALLED_PARTY);
      }
      else {
        assert.fail('No speech to speech vendor configured');
      }

      // A party jambonz socket
      this.a_adapter.setIncomingJambonzSocket(ws);
      this.b_adapter.setOutgoingJambonzSocket(ws);
    }
    else {
      // B party jambonz socket
      this.b_adapter.setIncomingJambonzSocket(ws);
      this.a_adapter.setOutgoingJambonzSocket(ws);
    }
  }

  close() {
    this.a_adapter?.close();
    this.b_adapter?.close();
    this.a_adapter = this.b_adapter = null;
  }
}

module.exports = Switchman;
