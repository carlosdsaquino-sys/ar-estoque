Os testes database.mjs executam todas as migrações em PGlite, criando somente papéis e uma tabela auth.users simulados no banco de teste. A implementação de negócio testada é o SQL real das migrações. Nenhuma credencial real é usada.
Os testes utils.mjs verificam datas em America/Sao_Paulo, valores brasileiros e identificadores de operação.
Execute `npm test` após `npm ci`. Estes testes não substituem a integração de autenticação/e-mail no provedor real ou um teste de carga com várias conexões PostgreSQL.
