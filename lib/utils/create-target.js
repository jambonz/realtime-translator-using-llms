/**
 * Creates a target array for outbound dialing based on session data and environment variables
 * 
 * @param {Object} logger - Logger instance for logging messages
 * @param {string} to - The default destination number if no override
 * @returns {Array} - The target array to use for outbound dialing
 */
const createTarget = (logger, to) => {
  // Check if OUTBOUND_OVERRIDE is present
  if (process.env.OUTBOUND_OVERRIDE) {
    const override = process.env.OUTBOUND_OVERRIDE;
    
    // Handle phone number format (phone:16173333456)
    if (override.startsWith('phone:')) {
      if (logger) logger.info(`Using phone override: ${override.substring(6)}`);
      return [{
        type: 'phone',
        number: override.substring(6)
      }];
    } 
    // Handle user format (user:daveh@beachdog.sip.jambonz.cloud)
    else if (override.startsWith('user:')) {
      if (logger) logger.info(`Using user override: ${override.substring(5)}`);
      return [{
        type: 'user',
        name: override.substring(5)
      }];
    }
    // Handle SIP URI format (sip:1627444456@mypbx.com)
    else if (override.startsWith('sip:')) {
      if (logger) logger.info(`Using sip override: ${override}`);
      return [{
        type: 'sip',
        sipUri: override
      }];
    }
    
    // If format is unrecognized but override exists, log a warning and use default
    if (logger) logger.warn(`Unrecognized OUTBOUND_OVERRIDE format: ${override}, using default target: ${to}`);
  }
  
  // Default behavior - use the 'to' parameter
  return [{
    type: 'phone',
    number: to
  }];
};

module.exports = createTarget;
