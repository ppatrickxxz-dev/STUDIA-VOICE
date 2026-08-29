const heroStates = [
  { img: 'assets/hero_ui.webp', title: 'Pablo + Companions', desc: 'Companions entram por função e o Pablo assume o papel de guia principal da sessão.', bubbleTitle: 'Tô contigo.', bubbleText: 'Abre a ideia, sente o clima e vamos transformar isso em música.', energy: 'Escuta • criação • refinamento' },
  { img: 'assets/studio_dashboard.webp', title: 'Studio em movimento', desc: 'A experiência principal ganha profundidade com glow, hierarquia e player visual.', bubbleTitle: 'Hora de montar.', bubbleText: 'Vamos lapidar arranjo, voz e intenção sem perder a tua identidade.', energy: 'Construção • edição • performance' },
  { img: 'assets/projects.webp', title: 'Projetos com continuidade', desc: 'O universo do usuário vira coleção viva: histórico, progresso e retorno fácil.', bubbleTitle: 'Nada se perde.', bubbleText: 'Teus projetos ficam organizados para continuar do ponto certo.', energy: 'Histórico • progresso • retomada' },
  { img: 'assets/voice_lab.webp', title: 'Voice Lab em destaque', desc: 'Módulo vocal com leitura mais técnica, mas ainda acessível e emocional.', bubbleTitle: 'Escuta fina.', bubbleText: 'Aqui a voz ganha limpeza, afinação e presença sem perder o timbre.', energy: 'Voz • textura • detalhe' }
];
let heroIndex = 0;
const heroImg = document.getElementById('hero-screen-img');
const heroTitle = document.getElementById('hero-screen-title');
const heroDesc = document.getElementById('hero-screen-desc');
const bubbleTitle = document.getElementById('bubble-title');
const bubbleText = document.getElementById('bubble-text');
const energyText = document.getElementById('energy-text');
function updateHero(state) {
  heroImg.src = state.img;
  heroTitle.textContent = state.title;
  heroDesc.textContent = state.desc;
  bubbleTitle.textContent = state.bubbleTitle;
  bubbleText.textContent = state.bubbleText;
  energyText.textContent = state.energy;
}
setInterval(() => {
  heroIndex = (heroIndex + 1) % heroStates.length;
  updateHero(heroStates[heroIndex]);
}, 3200);

const tabData = {
  studio: { title: 'Modo Studio', text: '“Aqui a gente constrói a faixa. Te dou direção, você me traz a ideia.”', meter: '72%' },
  voice: { title: 'Modo Voice Lab', text: '“Respira, ouve e grava de novo se precisar. Vamos buscar o take certo.”', meter: '84%' },
  beat: { title: 'Modo Beat Lab', text: '“Sente o groove. Agora o foco é ritmo, pulsação e personalidade sonora.”', meter: '91%' },
  lyrics: { title: 'Modo Letras', text: '“Me dá a emoção central e eu te ajudo a encontrar verso, refrão e gancho.”', meter: '66%' },
  projects: { title: 'Modo Projetos', text: '“Teu universo criativo precisa continuar claro, bonito e fácil de retomar.”', meter: '59%' }
};
const buttons = document.querySelectorAll('.tab-button');
const panels = document.querySelectorAll('.tab-panel');
const reactionTitle = document.getElementById('reaction-title');
const reactionText = document.getElementById('reaction-text');
const reactionFill = document.getElementById('reaction-meter-fill');
buttons.forEach((btn) => {
  btn.addEventListener('click', () => {
    buttons.forEach((button) => button.classList.remove('active'));
    panels.forEach((panel) => panel.classList.remove('active'));
    btn.classList.add('active');
    const key = btn.dataset.tab;
    document.getElementById(`tab-${key}`).classList.add('active');
    reactionTitle.textContent = tabData[key].title;
    reactionText.textContent = tabData[key].text;
    reactionFill.style.width = tabData[key].meter;
  });
});
