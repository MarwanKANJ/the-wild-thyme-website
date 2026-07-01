exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ok: true, service: 'functions', ts: Date.now() })
  };
};
