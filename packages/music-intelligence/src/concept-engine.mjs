import { normalizePortuguese } from '../../songwriting/src/analyzer.mjs';

const EMOTION_HINTS = Object.freeze({
  saudade: ['saudade', 'falta', 'lembrança', 'lembranca', 'voltar', 'distância', 'distancia'],
  desejo: ['desejo', 'beijo', 'pele', 'quarto', 'vontade', 'tesão', 'tesao', 'sedução', 'seducao'],
  descoberta: ['descoberta', 'caminho', 'viagem', 'inesperado', 'destino', 'aventura', 'novo'],
  ruptura: ['fim', 'adeus', 'partida', 'acabou', 'despedida', 'perder'],
  celebração: ['festa', 'dança', 'danca', 'noite', 'brilhar', 'celebrar', 'livre'],
  vulnerabilidade: ['medo', 'segredo', 'choro', 'sozinho', 'sozinha', 'confesso', 'confessar'],
});

const STOP = new Set(['uma','umas','um','uns','de','da','do','das','dos','e','a','o','as','os','pra','para','por','com','sem','que','eu','tu','voce','me','te','se','isso','essa','esse','sobre','quero','musica']);

export function buildConcept(brief = '', options = {}) {
  const source = String(brief || '').trim();
  if (!source) throw new Error('concept_brief_required');
  const normalized = normalizePortuguese(source);
  const anchors = [...new Set(normalized.split(' ').filter((word) => word.length >= 4 && !STOP.has(word)))].slice(0, 8);
  const emotions = Object.entries(EMOTION_HINTS)
    .map(([emotion, words]) => ({ emotion, hits: words.filter((word) => normalized.includes(normalizePortuguese(word))).length }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((item) => item.emotion);
  const pointOfView = /\b(eu|meu|minha|me|comigo)\b/i.test(source)
    ? 'primeira_pessoa'
    : /\b(voce|você|te|seu|sua)\b/i.test(source) ? 'segunda_pessoa' : 'a_definir';
  const tension = inferTension(normalized, anchors);
  const payoff = inferPayoff(normalized, anchors);
  return Object.freeze({
    premise: source.replace(/\s+/g, ' ').trim(),
    anchors,
    emotions: emotions.length ? emotions : ['aberto'],
    pointOfView,
    tension,
    payoff,
    genre: String(options.genre || '').trim() || null,
    mood: String(options.mood || '').trim() || null,
    directions: buildDirections(source, anchors, tension, payoff),
    creativeQuestions: [
      'O que muda entre o começo e o fim da música?',
      'Qual frase poderia resumir a música sem explicar tudo?',
      'Qual imagem concreta torna essa ideia reconhecível?',
    ],
    status: 'concept_ready',
  });
}

export const extractConcept = buildConcept;

function inferTension(text, anchors) {
  if (/nao chegou|desencontro|perdeu|falhou|deu errado|fora do plano/.test(text)) return 'o plano inicial entra em conflito com o que realmente acontece';
  if (/quer.*mas|mas.*quer|nega|esconde|finge/.test(text)) return 'o desejo aparece antes da admissão';
  if (/saudade|falta|distancia/.test(text)) return 'a ausência disputa espaço com a vontade de seguir';
  return anchors.length >= 2 ? `colocar ${anchors[0]} em conflito com ${anchors[1]}` : 'descobrir o conflito emocional que move a música';
}

function inferPayoff(text, anchors) {
  if (/caminho|viagem|aventura|destino/.test(text)) return 'perceber que o valor estava no percurso, não no destino';
  if (/nega|esconde|finge|desejo|beijo/.test(text)) return 'deixar o comportamento revelar o que a fala tenta esconder';
  return anchors[0] ? `transformar ${anchors[0]} em uma conclusão emocional memorável` : 'chegar a uma imagem ou frase que reorganiza o sentido da história';
}

function buildDirections(source, anchors, tension, payoff) {
  const subject = anchors.slice(0, 3).join(', ') || source;
  return Object.freeze([
    Object.freeze({ id: 'narrative', label: 'Narrativa', angle: `contar a história em cenas concretas usando ${subject}`, tension, payoff, priority: 'progressão e imagens' }),
    Object.freeze({ id: 'intimate', label: 'Íntima', angle: 'aproximar a câmera da sensação e do detalhe pessoal', tension, payoff, priority: 'voz autoral e subtexto' }),
    Object.freeze({ id: 'hook_first', label: 'Hook primeiro', angle: 'começar pela contradição mais memorável e construir os versos para justificá-la', tension, payoff, priority: 'refrão e frase-título' }),
  ]);
}
