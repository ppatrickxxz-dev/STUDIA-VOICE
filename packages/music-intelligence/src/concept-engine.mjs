const EMOTION_HINTS = Object.freeze({
  saudade: ['saudade', 'falta', 'lembrança', 'lembranca', 'voltar'],
  desejo: ['desejo', 'beijo', 'pele', 'quarto', 'vontade', 'tesão', 'tesao'],
  descoberta: ['descoberta', 'caminho', 'viagem', 'inesperado', 'destino', 'aventura'],
  ruptura: ['fim', 'adeus', 'partida', 'acabou', 'despedida'],
  celebração: ['festa', 'dança', 'danca', 'noite', 'brilhar', 'celebrar']
});

export function buildConcept(brief = '') {
  const source = String(brief || '').trim();
  if (!source) throw new Error('concept_brief_required');
  const normalized = source.toLowerCase();
  const emotions = Object.entries(EMOTION_HINTS)
    .filter(([, words]) => words.some((word) => normalized.includes(word)))
    .map(([emotion]) => emotion);
  const premise = source.replace(/\s+/g, ' ').trim();
  return {
    premise,
    emotions: emotions.length ? emotions : ['aberto'],
    pointOfView: /\b(eu|meu|minha|comigo)\b/i.test(source) ? 'primeira_pessoa' : 'a_definir',
    creativeQuestions: [
      'O que muda entre o começo e o fim da música?',
      'Qual frase poderia resumir a música sem explicar tudo?',
      'Qual imagem concreta torna essa ideia reconhecível?'
    ],
    status: 'concept_ready'
  };
}
