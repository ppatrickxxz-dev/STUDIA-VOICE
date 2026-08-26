export default function handler(req, res) {
  const elevenConfigured = Boolean(process.env.ELEVENLABS_API_KEY);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    benchmark: 'PabloVoice Benchmark v1',
    providers: {
      elevenmusic: {
        transport: 'official_api',
        configured: elevenConfigured,
        runnable: elevenConfigured,
      },
      suno: {
        transport: 'interactive_manual',
        configured: true,
        runnable: true,
        automation: false,
      },
      pablovoice: {
        transport: 'internal_runtime',
        configured: true,
        runnable: true,
      },
    },
    secrets_exposed: false,
  });
}
