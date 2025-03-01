const yardMaster = require('../utils/yardmaster');
const createTarget = require('../utils/create-target');
const safeClose = require('../utils/safe-close');
const SAMPLE_RATE = process.env.OPENAI_API_KEY ? 24000 : 8000;

const service = ({logger, makeService}) => {
  const svc = makeService({path: '/openai-translator'});

  svc.on('session:new', (session) => {
    const {from, to, call_sid} = session;
    session.locals = {
      logger: logger.child({call_sid: session.call_sid}),
      call_sid_a: call_sid
    };
    logger.info({session}, `new incoming call: ${session.call_sid}`);

    try {
      // Add session to yardMaster
      yardMaster.addSession(session.call_sid);

      // Set up error handling
      session
        .on('close', onClose.bind(null, session))
        .on('error', onError.bind(null, session));

      session
        .config({
          listen: { // audio stream from caller (A leg)
            enable: true,
            url: '/audio-stream',
            mixType: 'mono',
            sampleRate: SAMPLE_RATE,
            bidirectionalAudio: {
              enabled: true,
              streaming: true,
              sampleRate: SAMPLE_RATE
            }
          },
        })
        .dub({  // dub track to play translated audio back to caller
          action: 'addTrack',
          track: 'b_translated'
        });

      // optionally lower the volume of the speakers so the translator voice is clear
      if (process.env.LOWER_VOLUME && /^-([1-9]|[1-3][0-9]|4[0-5])\s*db$/i.test(process.env.LOWER_VOLUME)) {
        session.config({
          boostAudioSignal: process.env.LOWER_VOLUME
        });
      }

      // Use createTarget to get the target array
      const target = createTarget(session.locals.logger, to);

      session
        .dial({
          callerId: process.env.CALLER_ID_OVERRIDE || from,
          target: target,
          listen: { // audio stream from called party (B leg)
            url: '/audio-stream',
            channel: 2,  // stream only the called party audio on this socket
            mixType: 'mono',
            sampleRate: SAMPLE_RATE,
            bidirectionalAudio: {
              enabled: true,
              streaming: true,
              sampleRate: SAMPLE_RATE
            }
          },
          dub: [
            { // dub track to play translated audio back to called party
              action: 'addTrack',
              track: 'a_translated'
            }
          ]
        })
        .hangup()
        .send();
    } catch (err) {
      session.locals.logger.error({err}, `Error responding to incoming call: ${session.call_sid}`);
      try {
        safeClose(session.locals.logger, session.call_sid);
        session.close();
      } catch (closeErr) {
        session.locals.logger.error({err: closeErr}, `Error closing session after dial failure: ${session.call_sid}`);
      }
    }
  });
};

const onClose = (session, code, reason) => {
  const {logger} = session.locals;
  logger.info({session, code, reason}, `session ${session.call_sid} closed`);
  try {
    safeClose(logger, session.call_sid);
  } catch (err) {
    logger.error({err}, `Error in safeClose during onClose for session ${session.call_sid}`);
  }
};

const onError = (session, err) => {
  const {logger} = session.locals;
  logger.error({err}, `session ${session.call_sid} received error`);
  try {
    safeClose(logger, session.call_sid);
  } catch (closeErr) {
    logger.error({err: closeErr}, `Error in safeClose during onError for session ${session.call_sid}`);
  }
};

module.exports = service;
