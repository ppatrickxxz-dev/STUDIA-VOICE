const $=id=>document.getElementById(id);
const states=[
['assets/hero_ui.webp','Pablo + Companions','Companions entram por função e o Pablo assume o papel de guia principal da sessão.','Tô contigo.','Abre a ideia, sente o clima e vamos transformar isso em música.','Escuta • criação • refinamento'],
['assets/studio_dashboard.webp','Studio em movimento','A experiência principal ganha profundidade com glow, hierarquia e player visual.','Hora de montar.','Vamos lapidar arranjo, voz e intenção sem perder a tua identidade.','Construção • edição • performance'],
['assets/projects.webp','Projetos com continuidade','O universo do usuário vira coleção viva: histórico, progresso e retorno fácil.','Nada se perde.','Teus projetos ficam organizados para continuar do ponto certo.','Histórico • progresso • retomada'],
['assets/voice_lab.webp','Voice Lab em destaque','Módulo vocal com leitura mais técnica, mas ainda acessível e emocional.','Escuta fina.','Aqui a voz ganha limpeza, afinação e presença sem perder o timbre.','Voz • textura • detalhe']];
const hero=['hero-screen-img','hero-screen-title','hero-screen-desc','bubble-title','bubble-text','energy-text'].map($);
let i=0;
function show(s){hero[0].src=s[0];for(let n=1;n<6;n++)hero[n].textContent=s[n]}
setInterval(()=>show(states[i=++i%states.length]),3200);
const tabs={
studio:['Modo Studio','“Aqui a gente constrói a faixa. Te dou direção, você me traz a ideia.”','72%'],
voice:['Modo Voice Lab','“Respira, ouve e grava de novo se precisar. Vamos buscar o take certo.”','84%'],
beat:['Modo Beat Lab','“Sente o groove. Agora o foco é ritmo, pulsação e personalidade sonora.”','91%'],
lyrics:['Modo Letras','“Me dá a emoção central e eu te ajudo a encontrar verso, refrão e gancho.”','66%'],
projects:['Modo Projetos','“Teu universo criativo precisa continuar claro, bonito e fácil de retomar.”','59%']};
const buttons=document.querySelectorAll('.tab-button'),panels=document.querySelectorAll('.tab-panel');
buttons.forEach(button=>button.addEventListener('click',()=>{
buttons.forEach(node=>node.classList.remove('active'));panels.forEach(node=>node.classList.remove('active'));button.classList.add('active');
const key=button.dataset.tab,[title,text,meter]=tabs[key];$(`tab-${key}`).classList.add('active');$('reaction-title').textContent=title;$('reaction-text').textContent=text;$('reaction-meter-fill').style.width=meter;
}));
