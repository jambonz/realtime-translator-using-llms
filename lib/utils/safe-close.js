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
    // Log the error but prevent it from crashing the application
    if (logger) {
      logger.error({err}, `Error safely closing session ${sessionId}`);
    } else {
      console.error(`Error safely closing session ${sessionId}:`, err);
    }
  }
};

module.exports = safeClose;
