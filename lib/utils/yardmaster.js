const Emitter = require('events');
const logger = require('./logger');
const Switchman = require('./switchman');
/**
 * The Yardmaster class is responsible for managing all of the audio switching
 * being performed by the Switchman instances
 *
 */
class Yardmaster extends Emitter {
  constructor() {
    super();
    this.logger = logger;
    this.switchmen = new Map();
  }

  addSession(callSid) {
    const switchman = new Switchman(this.logger, callSid);
    this.switchmen.set(callSid, switchman);
    this.logger.info(`Yardmaster: added session for call_sid ${callSid}, there are ${this.switchmen.size} sessions`);
  }

  addJambonzWebsocket(ws, callSid, parentCallSid) {
    const switchman = this.switchmen.get(parentCallSid || callSid);
    if (switchman) {
      switchman.addJambonzWebsocket(ws, callSid);
    }
  }

  close(callSid) {
    const switchman = this.switchmen.get(callSid);
    if (switchman) {
      switchman.close();
      this.switchmen.delete(callSid);
      this.logger.info(
        `Yardmaster: removed session for call_sid ${callSid}, there are ${this.switchmen.size} sessions`);
    }
  }
}

// create a singleton session manager
module.exports = new Yardmaster();
