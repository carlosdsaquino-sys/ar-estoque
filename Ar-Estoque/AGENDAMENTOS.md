# Agendamentos

O dropdown Serviços reúne os links reais `/servicos` e `/agendamentos`, no desktop e no celular. A rota `/agendamentos` usa o roteamento e os links reais existentes, com rewrite no Vercel. As visualizações Dia, Semana e Mês mostram cards do período selecionado; Lista mostra o histórico ordenado por data, horário e cliente. Os filtros permitem Hoje, Amanhã, Próximos, Todos, Cancelados e Concluídos. O dia atual aparece destacado. Modal, SearchableSelect e controles do sistema foram reutilizados, preservando o tema.

## Banco e instalação

Aplicar `supabase/migrations/20261001180000_appointments.sql` no Supabase após as migrations anteriores, antes de disponibilizar esta versão do frontend. Em seguida, aplicar `supabase/migrations/20261001190000_service_actor_and_appointment_hours.sql`, que reforça o técnico manual e a duração mínima. A migration foi testada em PostgreSQL local via PGlite; não foi aplicada ao banco remoto.

As novas tabelas são `appointments` e `appointment_appliances`. O histórico reutiliza `service_history` com uma referência opcional ao agendamento. As escritas acontecem pelas RPCs `save_appointment` e `save_appointment_service`, que exigem usuário ativo, validam cliente/aparelhos, impedem duplicidades e usam transações. RLS permite leitura aos membros ativos e não concede escrita direta. A versão do registro impede sobrescrever edições concorrentes. Técnico é texto digitado; `created_by` vem de `auth.uid()`.

Não são gerados agendamentos a partir de serviços antigos. Datas são `date`, horários são `time`; os filtros usam o calendário local, sem converter o dia escolhido para UTC.

## Serviços e manutenção

Iniciar atendimento abre o formulário existente de Serviços com cliente, técnico, data, observações e aparelhos. O tipo de serviço, quando ainda ativo, é colocado em cada aparelho com seu preço atual. O usuário ajusta o atendimento antes de salvar. O serviço só nasce ao salvar esse formulário.

Salvar rascunho vincula o serviço e mantém o agendamento pendente. A ação passa a ser Continuar atendimento. Confirmar o serviço conclui o agendamento no banco, inclusive quando o rascunho é confirmado posteriormente pela tela Serviços. Cancelar esse serviço preserva o agendamento concluído e seu vínculo. Agendamentos vinculados ficam protegidos contra edição/cancelamento para preservar o histórico. Corrigir informações do atendimento deve ocorrer no fluxo de Serviços.

Agendar limpeza, em Avisos, abre um novo agendamento com cliente, aparelho e tipo recorrente da última manutenção, quando o tipo ainda existir. A regra de cálculo de prazos continua na função `maintenance_overview`; sua resposta foi estendida com o tipo de serviço.

## Avisos diários

Um único modal Avisos do dia aguarda o carregamento de manutenção e agenda. Conta apenas Agendado e Confirmado para hoje e amanhã; reutiliza as contagens atuais de manutenção. Sem avisos, não abre. Falhas de carregamento não são interpretadas como ausência de avisos.

A chave `ar-estoque-daily-alerts-{userId}-{yyyy-mm-dd}` é gravada ao exibir o modal. Um guard adicional evita repetição na sessão. Não há novos listeners de `focus` ou `visibilitychange`, nem reload; navegação e F5 respeitam a chave. A atualização à meia-noite usa o mesmo padrão já existente no sistema. Se o navegador bloquear localStorage, a proteção vale apenas para a sessão atual.

O menu mostra Agendamentos com badge dos pendentes de hoje/amanhã. O Dashboard não foi alterado. As integrações opcionais de histórico no detalhe do cliente/aparelho não foram adicionadas.

## Validação

`npm test` cobre migrations e regras reais do banco: permissões, criação, edição, versão concorrente, cancelamento, duplicidade, aparelho de outro cliente, vínculo com rascunho, confirmação e preservação após cancelar serviço. `tests/utils.mjs` verifica contagens por status, datas locais e a chave por usuário/dia.

Antes de publicar, conferir na interface autenticada: criar/editar/cancelar; pré-preenchimento e confirmação do serviço; popup com avisos; F5/troca de aba; abrir agenda diretamente e em nova aba; tema claro/escuro e telas menores. Essa validação visual com uma sessão real não foi executada nesta implementação.

## Correções de duração, navegação e técnico

A interface recebe duração em horas, inclusive com vírgula decimal, e converte para minutos ao salvar (3 → 180; 3,5 → 210). A duração continua opcional. Quando informada em novos registros ou alterada, o mínimo é 3 horas, tanto no formulário quanto no banco. Não há multiplicação pela quantidade de aparelhos. Registros antigos menores que 180 minutos são preservados, inclusive em edições de outros campos.

O término é calculado automaticamente no formulário, nos cards e nos detalhes. A passagem para o dia seguinte é indicada, por exemplo 23:30 + 3,5 horas → 03:00 (+1 dia).

A migration de correção reaplica a definição atual de set_service_actor e save_service_visit, pois migrations antigas tinham sobrescrita do técnico pelo nome do usuário. O formulário existente já inicializa um novo serviço com técnico vazio e envia o texto digitado; atendimentos derivados da agenda usam o técnico do agendamento. created_by continua sendo auth.uid(), e a migration não reescreve técnicos históricos.

Os testes simulam uma trigger antiga que sobrescreve o técnico antes de aplicar a correção e comprovam que Queticia/Pedro são preservados na criação, edição e confirmação. Também cobrem o mínimo de duração, valores decimais, término com virada de dia e resolução das duas rotas.
