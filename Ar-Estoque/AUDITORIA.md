# Auditoria e correções — Ar-Estoque

Auditoria do checkout local em 02/10/2026. Foram inventariados os 34 arquivos de fonte, 20 migrations, configurações de build/rotas e testes. As migrations foram executadas em PostgreSQL local via PGlite, incluindo reaplicação da migration nova. Não houve consulta, alteração, exclusão ou reset do Supabase de produção.

## Problemas confirmados e correções

| Problema e causa | Impacto | Correção na origem |
|---|---|---|
| `save_appointment_service` retornava o serviço vinculado para qualquer nova tentativa de criação | O formulário podia informar sucesso sem salvar alterações | Retry exige o mesmo usuário, request, payload e resultado; operações novas conflitantes retornam erro |
| Criar agendamento não usava request_id | Retry após resposta perdida podia criar dois compromissos | Nova assinatura idempotente de `save_appointment`, usando `operation_requests` existente; formulário e cancelamento enviam request_id |
| Movimento manual do caixa não tinha request_id | Retry podia lançar receita/despesa duas vezes | Nova assinatura idempotente de `record_cash_movement`; frontend preserva request em erro e o renova após sucesso |
| Integração da agenda travava agendamento antes do lock global, enquanto confirmação de serviço podia atualizar agenda após obter lock global | Ciclo potencial de deadlock entre transações | Mesmo lock global antes do lock de agendamento; análise da ordem, sem alegar teste multissessão real |
| Salvar/cancelar agenda exigia cliente, tipo e aparelhos ainda ativos, mesmo para vínculos históricos intactos | Arquivar cliente/inativar aparelho podia impedir cancelamento | RPC permite conservar vínculos existentes; continua impedindo novos vínculos inativos ou aparelho de outro cliente |
| `appointments.created_by` referenciava profiles sem ON DELETE SET NULL, sendo obrigatório | Exclusão autorizada de conta falhava por FK após criar agenda | Nome do autor preservado em snapshot, FK passa a SET NULL e o compromisso permanece |
| Editar serviço conservava snapshots de manutenção, mas recopiava nome/descrição atuais do tipo | Renomear cadastro e depois editar técnico alterava a descrição histórica do atendimento | `save_service_visit` conserva nome/descrição do serviço realizado quando o mesmo item/tipo permanece |
| Cada Modal e DialogProvider tratava ESC/Tab independentemente | ESC na confirmação podia fechar também o formulário; foco e scroll disputados | Registro compartilhado de overlays, com prioridade dos diálogos e bloqueio de scroll até o último overlay fechar |
| Requests concorrentes aplicavam resposta sem verificar se ainda era a mais recente | Filtros recentes podiam exibir dados de pesquisa anterior; providers podiam aceitar resposta após logout/troca de conta | Versionamento das cargas em Serviços, Movimentações, Relatórios, manutenção e agenda; cleanup invalida requests pendentes |
| Navegação mensal somava/subtraía o número de dias de um mês | Dia 31 podia continuar no mesmo mês ao pedir Anterior | Deslocamento por mês de calendário, com ajuste para o último dia válido |
| Reserva de código de produto atribuía o ref mesmo após desmontar o formulário | Em StrictMode/respostas fora de ordem, cleanup podia liberar a reserva errada | Apenas a instância ativa guarda a reserva; instância cancelada libera seu próprio código |
| Paginação por nomes sem desempate por ID | Nomes iguais podiam deixar a ordem das páginas instável | Desempate por ID nos produtos do relatório e aparelhos carregados para Serviços |
| Formulários de cliente, tipo e caixa não verificavam `saving` no submit | Enter podia reenviar enquanto o botão estava desabilitado | Guard no submit; modais não fecham durante salvamento; caixa libera estado de envio também em exceções |
| Clientes, Caixa e Usuários dependiam de estado legado em `/`; usuário sem permissão nessa página via histórico via tela vazia | Links dessas páginas não tinham rota própria; acesso negado não era explicado | `/clientes`, `/caixa`, `/usuarios`, rewrites e mensagem de acesso restrito, com RLS/RPCs mantidas |
| Logout limpava a UI, mas seu finally não zerava o ref de identidade se a chamada Supabase falhasse | Uma entrada posterior com a mesma conta podia ser tratada como evento do usuário anterior | Limpeza do ref no finally do logout |

As duas funções de trigger `set_service_actor` e `capture_performed_service_maintenance_snapshot` tinham permissão pública de EXECUTE desnecessária. Foi revogada. São funções que retornam `trigger`, não RPCs comuns executáveis diretamente; não foi demonstrada exploração ou vazamento por essas permissões.

## Banco

Nova migration: `supabase/migrations/20261002100000_audit_integrity.sql`. Aplicar no Supabase **depois das migrations anteriores e antes de publicar o frontend atualizado**.

- Atualiza `save_appointment`, `save_appointment_service` e `save_service_visit`.
- Adiciona sobrecargas com request_id para `save_appointment` e `record_cash_movement`, preservando compatibilidade das assinaturas antigas. A proteção de retry depende de usar as novas assinaturas, como faz o frontend atualizado.
- Usa a tabela existente `operation_requests`; não cria segundo sistema de caixa/auditoria/idempotência.
- Adiciona `appointments.created_by_name`, preenche nomes disponíveis, permite created_by nulo somente para preservar registros após remoção da conta e adiciona trigger para capturar autor no INSERT.
- Revoga EXECUTE público dos dois helpers de trigger citados. Policies de acesso não foram relaxadas ou substituídas.
- Nenhuma tabela ou registro empresarial é apagado pela migration. A reaplicação foi executada e aprovada nos testes locais.

O inventário completo de RPCs, parâmetros, retornos, chamadores, permissões, policies, triggers e tabelas está em **AUDITORIA-INVENTARIO.md**, gerado por `npm run test:audit` a partir do esquema resultante das migrations.

## Estoque e últimas movimentações

Executado com um produto isolado de teste:

| Operação | Saldo |
|---|---:|
| Entrada inicial | 10 |
| Confirmar serviço com material × 1 | 9 |
| Repetir o mesmo request de confirmação | 9 |
| Editar confirmado sem alterar material | 9 |
| Retirar material | 10 |
| Adicionar novamente | 9 |
| Cancelar com devolução | 10 |
| Criar e arquivar rascunho | 10 |

Edições de serviços confirmados geram estornos e novas saídas com IDs distintos. Os testes verificam a compensação e a preservação do saldo. A lista do Dashboard não deduplica e usa um relacionamento muitos-para-um com o produto, `created_at DESC NULLS LAST`, ID para desempate e limite de dez. Scroll, ícones, cores e quantidades assinadas foram preservados.

Sem consultar IDs do banco remoto, não é possível certificar quais operações produziram os registros específicos de Fita PVC citados pelo usuário. `supabase/audit_recent_movements.sql` permite conferir isso sem alterar dados.

## Fluxos revisados e evidências

| Área | Resultado e limites |
|---|---|
| Estoque/movimentações | Sequência completa acima executada; testes de estorno, idempotência, saldo insuficiente, duplicidade de material e rollback da suíte existente |
| Serviços | Técnico manual, autor autenticado, edição/versionamento, múltiplos aparelhos, snapshots, confirmação, cancelamento e rascunhos testados no banco; redução de aparelhos usa confirmação personalizada |
| Pagamentos | Suíte executa recebimento, repetição, reversão e vinculação única aos eventos do caixa; serviço pago não pode ser editado sem corrigir pagamento |
| Pagamento parcial | Não existe modelo/fluxo de pagamento parcial neste projeto. Não foi inventado nem implementado como parte da auditoria |
| Caixa | Abertura única, fechamento, diferença/motivo, ajustes administrativos, operações após fechamento e recebimento/reversão cobertos; nova repetição de movimento manual verificada antes e após fechamento |
| Manutenção | `service_date` é a referência; apenas confirmados com snapshot recorrente entram; cancelados/rascunhos não entram; intervalos/classificações e preservação após excluir tipo testados |
| Manutenções anteriores ao módulo | Aparelhos sem identificação confiável e registros sem snapshot histórico não foram reconstruídos por suposição. Configuração atual do tipo não prova a configuração na data do atendimento. Sem backfill inventado |
| Agendamentos | Criação, edição, versão concorrente, cancelamento, aparelhos do cliente, duração mínima/conversão, retry, vínculo com rascunho/confirmação e preservação após cancelar serviço cobertos |
| Clientes/aparelhos | Cadastro/edição/arquivo e exclusão guardada revisados; novo teste cancela agenda após arquivar cliente e inativar aparelho |
| Produtos/tipos | Regras de códigos e permissões testadas; preço usado no atendimento é independente do cadastro mestre; manutenção/snapshots não desaparecem ao excluir tipo |
| Lucros | Receita confirmada menos custo histórico de materiais, descontos, múltiplas linhas e estados de pagamento cobertos pelos testes; período usa service_date |
| Login/sessão | Login explícito vai a Dashboard; restauração/F5 usa URL. Eventos de foco só verificam virada do dia; não há reload ou redirecionamento nesses listeners. Testes de datas/rotas executados; login real em navegador não executado |
| Rotas | Operacional e relatório de movimentações continuam separados; routes/rewrite revisados e testes de precedência da URL executados |
| Avisos diários | Um único modal; chave por usuário/dia; espera cargas e ignora cancelados/concluídos/não compareceu. Contagens/chaves testadas; persistência no navegador real não executada |
| RLS/RPCs | Inventário local verifica 22 tabelas com RLS, 26 nomes de RPC do frontend existentes e restritos a autenticados, guards de perfil ativo e ausência de INSERT direto nas tabelas transacionais |
| Modal/SearchableSelect | Teclado, portal, z-index, filtro, seleção e responsividade revisados por código; prioridade/scroll de overlays testados como lógica. Não houve teste visual automatizado nos dispositivos |
| Importação | Validação numérica, códigos, reimportação, regras administrativas e atomicidade cobertos pela suíte existente; arquivo real do usuário não foi importado |
| Tema/layout | Persistência e regras CSS/dark revisadas; nenhum redesenho. Contraste/renderização visual não aferidos em navegador real |

As exclusões permanentes de produto e cliente já eram explicitamente destrutivas e pediam confirmação. A auditoria não executou essas ações na produção nem mudou silenciosamente sua regra: produto remove seus movimentos/materiais; cliente arquivado pode remover seus serviços. Os saldos e os efeitos dessas regras estão cobertos por fixtures locais. Vínculos de agendamento continuam impedindo exclusão do histórico relacionado por FK. Isso exige uma decisão de negócio se a intenção futura for conservar também todo histórico de produtos/clientes após exclusão permanente.

## Arquivos desta auditoria

Banco: nova migration acima.

Frontend: `src/App.tsx`, `src/lib/routes.ts`, `src/lib/appointments.ts`, `src/lib/overlays.ts`, `src/components/ui.tsx`, `src/components/DialogProvider.tsx`, `src/context/AuthContext.tsx`, `src/context/MaintenanceContext.tsx`, `src/context/AppointmentsContext.tsx`, `src/pages/Appointments.tsx`, `src/pages/Cash.tsx`, `src/pages/Clients.tsx`, `src/pages/ServiceTypes.tsx`, `src/pages/Products.tsx`, `src/pages/Services.tsx`, `src/pages/Movements.tsx`, `src/pages/Reports.tsx`, `vercel.json`.

Validação/documentação: `package.json` (test:audit), `tests/database.mjs`, `tests/utils.mjs`, `tests/audit-inventory.mjs`, `AUDITORIA.md`, `AUDITORIA-INVENTARIO.md`.

## Verificação final executada

- `npm run build`: aprovado; 1.670 módulos compilados. Avisos: pacote JavaScript de 860,39 kB e base caniuse-lite desatualizada.
- `npm run typecheck`: aprovado, sem erros.
- `npm run lint`: aprovado, zero erros e sete avisos de `react-refresh/only-export-components`.
- `npm test`: aprovado, 233 verificações de banco e testes de utilitários, lucro, agenda, duração, rotas, navegação mensal e overlays.
- `npm run test:audit`: aprovado, 26 nomes de RPC, 22 tabelas com RLS, nove triggers, 20 migrations e 34 arquivos de fonte; migration de correção reaplicada.
- `git diff --check`: aprovado; apenas avisos do Git sobre normalização LF/CRLF.

## Limites da validação efetiva

Não foram validados dados de produção, migrations efetivamente instaladas no Supabase remoto, configuração/deploy de Edge Functions, autenticação com credenciais reais, concorrência com múltiplas conexões PostgreSQL reais, cliques/F5/troca de aba em sessão autenticada nem aparência em dispositivos. O lock foi corrigido pela análise da ordem de aquisição; não foi alegada reprodução de deadlock multissessão em PGlite.

As operações de criação/cancelamento/exclusão usadas pelos testes são exclusivamente fixtures no banco efêmero local. Nenhum dado existente do usuário foi removido para facilitar testes.
