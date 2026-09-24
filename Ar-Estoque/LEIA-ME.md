# Ar Estoque

## Para atualizar

1. Guarde uma cópia do projeto e do banco atuais.
2. Substitua o código pelos arquivos deste ZIP. Preserve o seu `.env` original ou configure as variáveis conforme `.env.example`.
3. No SQL Editor do banco usado pelo projeto, execute **somente** `supabase/migrations/20260922200000_integrity_and_access.sql`, se as três migrações originais já foram aplicadas. Execute o arquivo completo, uma vez. A migração precisa rodar com o usuário administrador do banco.
4. Para um banco novo, execute os quatro arquivos de `supabase/migrations` em ordem de nome.
5. Instale e inicie:

```bash
npm ci
npm run dev
```

Use Node.js 22 ou mais recente. O ZIP contém o código-fonte, não inclui node_modules nem credenciais. No Bolt, configure as variáveis de ambiente já usadas pelo seu projeto. Não coloque uma chave `service_role` no frontend.

**Atualize código e migração juntos.** A interface corrigida usa novas funções do banco. Não basta substituir apenas as telas.

## Primeiro acesso e usuários

O cadastro cria um perfil de operador aguardando aprovação. Se houver confirmação de e-mail habilitada no provedor, confirme o endereço antes do login.

Perfis existentes mantêm a função que já tinham. Usuários antigos que ficaram sem perfil recebem um perfil pendente pela migração.

Se não houver administrador utilizável, cadastre sua conta e rode este comando no SQL Editor, substituindo o e-mail pelo seu endereço exato:

```sql
UPDATE public.profiles
SET role = 'admin', is_active = true
WHERE id = (
  SELECT id FROM auth.users
  WHERE lower(email) = lower('SEU_EMAIL_AQUI')
);
```

Confirme que uma linha foi alterada. Depois entre no sistema ou clique em “Verificar acesso”. Na página **Usuários**, o administrador libera as contas da equipe e define administrador ou operador. Nenhuma senha é incluída no projeto.

- Administrador: cadastros, ajustes, estornos, importação, correção de pagamentos e gestão de usuários.
- Operador: consultas, entradas, saídas, serviços e registro de pagamentos.
- Conta pendente/bloqueada: sem acesso aos dados da empresa.

Este é um sistema para **uma única empresa**. Não é um SaaS com isolamento entre várias empresas.

## Fluxos corrigidos

- Salvar serviço e seus materiais ocorre em uma transação. Na confirmação, a baixa de estoque faz parte da mesma operação. Erros desfazem a operação inteira.
- Reenvios da mesma operação não criam outro serviço ou outra movimentação.
- Operações de estoque são serializadas no banco por um bloqueio transacional. Todas as alterações da aplicação passam pelas funções protegidas.
- Saídas, ajustes negativos e estornos não podem deixar o saldo negativo.
- Serviços confirmados e ainda não pagos podem ser editados. As baixas anteriores recebem estornos vinculados e as novas baixas são registradas, com histórico e preservação do custo dos materiais existentes.
- O total é calculado no banco. O cliente não pode enviar um total arbitrário.
- Edições simultâneas são detectadas pela versão do serviço. No pagamento, a versão é conferida para evitar recebimento de um valor desatualizado.
- Para corrigir um serviço pago, um administrador deve usar **Corrigir pagamento**, informar o motivo, editar o serviço e registrar o pagamento correto.
- Corrigir pagamento apenas altera o controle interno. Não faz Pix, estorno de cartão ou reembolso bancário. Registre na justificativa qualquer devolução feita externamente.
- Para cancelar, escolha somente os materiais que efetivamente voltaram ao estoque. A devolução selecionada é da quantidade inteira daquela linha; materiais não selecionados permanecem consumidos. Serviços pagos precisam ter o pagamento regularizado antes do cancelamento.
- Rascunhos arquivados são cancelados para preservar o histórico.
- Ajustes aceitam números positivos para adicionar e negativos para retirar, sempre com justificativa.
- Datas sem horário mantêm o dia informado. Filtros de movimentações usam o fuso local do navegador.
- Valores como `1.234,56` são aceitos na importação. Reimportar um código existente não soma seu saldo inicial novamente.
- Saldos são consultados em lote. Listas principais e relatórios buscam todas as páginas em vez de exportar apenas os primeiros 200/500 registros.
- Categorias e unidades podem ser adicionadas pelo formulário do produto. O fornecedor também pode ser criado ali.

## Verificação executada

- Compilação de produção com Vite.
- Verificação TypeScript e ESLint.
- Migrações executadas em PostgreSQL incorporado via PGlite, com papéis de administrador, operador, conta pendente e anônimo.
- 41 verificações de banco: autorização, bloqueio de escrita direta, saldo insuficiente, duplicações, rollback, edição de confirmados, preservação de quantidade após falha, pagamentos, pagamento desatualizado, cancelamentos, estornos e importação.
- 14 verificações de datas, valores brasileiros, margem, limite de estoque e identificadores de reenvio.

Para repetir:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Os testes de banco usam um banco temporário em memória e não se conectam ao banco real. PGlite usa uma conexão: não houve teste de carga com várias conexões PostgreSQL independentes. O bloqueio transacional foi implementado para serializar essas operações.

A autenticação real, entrega de e-mails e integração com seu projeto Supabase/Bolt precisam ser conferidas após aplicar a migração. Não acessei nem alterei seu banco remoto. O navegador de testes não ficou disponível neste ambiente, portanto não houve validação visual automatizada.

A migração preserva registros históricos e não tenta adivinhar ou reescrever eventuais saldos incorretos já gerados pela versão antiga. Confira esses saldos e, se necessário, use ajustes justificados.

## Teste rápido após instalar

1. Cadastre um produto com custo 10 e venda 20. Registre uma entrada de 10 unidades.
2. Cadastre um cliente e um serviço com 3 unidades desse material, mão de obra 100 e desconto 10. Ao confirmar, espere total 150 e saldo 7.
3. Edite o serviço para 5 unidades. Espere total 190 e saldo 5.
4. Tente consumir 20 unidades: a operação deve falhar e preservar o saldo anterior.
5. Marque o serviço como pago. Confira o histórico do cliente e os indicadores.
6. Use um operador para conferir que ajustes administrativos, importação e gestão de acesso estão bloqueados no banco.
