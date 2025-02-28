/**
 * Creates a target array for outbound dialing based on session data and environment variables
 *
 * @param {Object} session - The session object containing call information
 * @returns {Array} - The target array to use for outbound dialing
 */
const createTarget = (logger, to) => {

  if (process.env.OUTBOUND_OVERRIDE) {
    const override = process.env.OUTBOUND_OVERRIDE;

    if (override.startsWith('phone:')) {
      return [{
        type: 'phone',
        number: override.substring(6)
      }];
    }
    else if (override.startsWith('user:')) {
      return [{
        type: 'user',
        name: override.substring(5)
      }];
    }
    else if (override.startsWith('sip:')) {
      return [{
        type: 'sip',
        sipUri: override
      }];
    }
    logger.info(`Unrecognized OUTBOUND_OVERRIDE format: ${override}, using default target`);
  }

  // Default behavior - use the 'to' parameter from the session
  return [{
    type: 'phone',
    number: to
  }];
};

module.exports = createTarget;
