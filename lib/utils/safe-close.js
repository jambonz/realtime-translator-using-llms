/**
 * Safely closes a yard session by adding error handling
 * 
 * @param {Object} logger - Logger instance to record errors
 * @param {string} sessionId - The session ID to close
 */
const safeClose = (logger, sessionId) => {
  try {
    const yardMaster = require('./yardmaster');
    
    // Check if the session exists before attempting to close
    if (yardMaster.hasSession(sessionId)) {
      yardMaster.close(sessionId);
    }
  } catch (err) {
      logger.info({err}, `Error safely closing session ${sessionId}`);
  }
};

module.exports = safeClose;
