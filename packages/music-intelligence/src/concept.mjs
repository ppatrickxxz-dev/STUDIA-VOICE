import { normalizePortuguese } from '../../songwriting/src/analyzer.mjs';

const EMOTION_LEXICON = Object.freeze({
  desejo: ['desejo','tesao','tesão','beijo','pele','quarto','vontade','seducao','sedução'],
  saudade: ['saudade','falta','lembranca','lembrança','voltar','distancia','distância'],
  ruptura: ['fim','acabou','partida','adeus','termino','término','despedida','perder'],
  descoberta: ['descobrir','descoberta','caminho','viagem','aventura','novo','inesperado'],
  euforia: ['festa','dancar','dançar','noite','brilho','livre','energia'],
  vulnerabilidade: ['medo','segredo','choro','sozinho','sozinha','confesso','confessar'],
});

const STOP = new Set(['uma','umas','um','uns','de','da','do','das','dos','e','a','o','as','os','pra','para','por','com','sem','que','eu','tu','voce','você','me','te','se','isso','essa','esse','sobre','quero','musica','música']);

export function extractConcept(idea = '', options = {}) {
  const original = String(idea || '').trim();
  const normalized = normalizePortuguese(original);
  const words = normalized.split(' ').filter(Boolean);
  const anchors = [...new Set(words.filter((word) => word.length >= 4 && !STOP.has(word)))].slice(0, 8);
  const emotions = Object.entries(EMOTION_LEXICON)
    .map(([name, terms]) => ({ name, hits: terms.filter((term) => normalized.includes(normalizePortuguese(term))).length }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((item) => item.name);
  const pointOfView = /\b(eu|meu|minha|me|comigo)\b/i.test(original) ? 'primeira_pessoa' : /\b(voce|você|te|seu|sua)\b/i.test(original) ? 'segunda_pessoa' : 'aberto';
  const tension = inferTension(normalized, anchors);
  const payoff = inferPayoff(normalized, anchors);

  return Object.freeze({
    premise: original || 'ideia ainda não definida',
    anchors,
    emotions: emotions.length ? emotions : ['aberto'],
    pointOfView,
    tension,
    payoff,
    genre: String(options.genre || '').trim() || null,
    mood: String(options.mood || '').trim() || null,
    directions: buildDirections({ original, anchors, tension, payoff }),
  });
}

function inferTension(text, anchors) {
  if (/nao chegou|não chegou|desencontro|perdeu|falhou|deu errado|fora do plano/.test(text)) return 'o plano inicial entra em conflito com o que realmente acontece';
  if (/quer.*mas|mas.*quer|nega|esconde|finge/.test(text)) return 'o desejo aparece antes da admissão';
  if (/saudade|falta|distancia|distância/.test(text)) return 'a ausência disputa espaço com a vontade de seguir';
  return anchors.length >= 2 ? `colocar ${anchors[0]} em conflito com ${anchors[1]}` : 'descobrir o conflito emocional que move a música';
}

function inferPayoff(text, anchors) {
  if (/caminho|viagem|aventura|destino/.test(text)) return 'perceber que o valor estava no percurso, não no destino';
  if (/nega|esconde|finge|desejo|beijo/.test(text)) return 'deixar o comportamento revelar o que a fala tenta esconder';
  return anchors[0] ? `transformar ${anchors[0]} em uma conclusão emocional memorável` : 'chegar a uma imagem ou frase que reorganiza o sentido da história';
}

function buildDirections({ original, anchors, tension, payoff }) {
  const subject = anchors.slice(0, 3).join(', ') || original || 'a ideia central';
  return Object.freeze([
    Object.freeze({ id: 'narrative', label: 'Narrativa', angle: `contar a história em cenas concretas usando ${subject}`, tension, payoff, priority: 'progressão e imagens' }),
    Object.freeze({ id: 'intimate', label: 'Íntima', angle: 'aproximar a câmera da sensação e do detalhe pessoal', tension, payoff, priority: 'voz autoral e subtexto' }),
    Object.freeze({ id: 'hook_first', label: 'Hook primeiro', angle: 'começar pela contradição mais memorável e construir os versos para justificá-la', tension, payoff, priority: 'refrão e frase-título' }),
  ]);
}
