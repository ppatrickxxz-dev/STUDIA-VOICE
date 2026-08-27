# PabloVoice — plano de fechamento do produto

## Meta

Entregar um único PabloVoice utilizável em Web + Android. O usuário participa principalmente de decisões criativas e avaliação de resultado; infraestrutura, deploy, autenticação, provedores, CI, banco e assinatura são responsabilidade de desenvolvimento.

## Regra de trabalho

Não abrir novas frentes paralelas enquanto existir um equivalente canônico. Toda ideia nova deve receber uma destas disposições: integrar agora, integrar depois, manter como pesquisa, ou superseder. Nenhuma ideia fica solta em chat como se fosse implementação.

## Ordem de fechamento

### 1. Verdade única
- `main` é a única fonte canônica.
- manter `MASTER_STATE.json` atualizado após mudança relevante;
- fechar PRs superseded;
- código implantado em Supabase/Vercel precisa existir no repositório na mesma versão.

### 2. Núcleo musical utilizável sem depender de geração paga
O produto deve continuar útil mesmo quando um provider externo estiver indisponível:
- abrir/criar projeto;
- importar/gravar áudio;
- análise musical compartilhada;
- edição e mixer;
- Breath/Alignment/Mix Intelligence;
- correção de nota conservadora quando disponível;
- Voice Lab e harmonias quando o backend real estiver disponível;
- stems quando a rota autenticada passar o canary;
- exportação.

### 3. Inteligência criativa
- usar Pablo Music Intelligence 1.0 como núcleo interno, sem criar superfície paralela;
- preservar Concept Engine, sessão de composição, Critic e Authorial Memory;
- conectar geração remota somente a um provider realmente disponível;
- provider indisponível nunca deve quebrar o Studio nem transformar o usuário em administrador de API.

### 4. Evidência real das IAs de áudio
Promover somente com execução real e retenção de evidência:
- B04 Voice Identity;
- B06 note correction;
- B07 high + low harmony pair;
- B09 standalone stems;
- B11 sequential edit continuity.

### 5. Recuperação das áreas já idealizadas
Migrar para a arquitetura atual, sem recriar produto paralelo:
- Instrument Lab / MIDI / sampler interativo;
- Podcast Cleanup;
- Video Audio;
- recursos históricos de edição/áudio ainda preservados no recovery ledger.

### 6. Camada criativa do produto
Depois do fluxo musical P0 utilizável:
- Pocket Studio / Studio Life;
- avatar pixel canônico;
- pets musicais e personalidades;
- progressão e memórias;
- animações, sons de interface e identidade visual aprovada.

Tudo deve devolver o usuário à música; gamificação não pode bloquear ferramentas nem punir ausência.

### 7. Release
- Web e Android saem da mesma base;
- Android usa `com.pablovoice.studio` e assinatura permanente;
- não repetir gates físicos antigos sem mudança que justifique regressão;
- teste físico final é orientado por delta;
- entregar uma atualização consolidada, não uma sequência de APKs para cada ajuste pequeno.

## Estado do provider de composição em 2026-08-27

O backend server-side e a leitura segura de credencial estão implementados. A primeira chamada real ao provider OpenAI retornou `billing_not_active`. Isso deve ser tratado como indisponibilidade de fornecedor, não como falha do produto inteiro. O restante do fechamento continua em paralelo.

## Definição de pronto

PabloVoice só é considerado produto fechado quando:
1. Web e Android usam a mesma fonte canônica;
2. o Android instalado recebe atualização assinada normalmente;
3. os fluxos principais podem ser usados sem configuração técnica pelo usuário;
4. módulos de IA exibem capacidade real ou indisponibilidade honesta, nunca falsa conclusão;
5. as ideias recuperadas têm disposição registrada;
6. uma sessão musical real consegue chegar de projeto a exportação;
7. a próxima rodada de trabalho pode partir da `main` sem precisar reconstruir contexto de chats.
