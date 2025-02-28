module.exports = ({logger, makeService}) => {
  require('./openai-translator')({logger, makeService});
};

