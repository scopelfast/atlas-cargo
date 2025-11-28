// gera-hash.js
const bcrypt = require('bcrypt');
const senha = "minhaSenha123"; // ← coloque a senha que quiser
const saltRounds = 10;

bcrypt.hash(senha, saltRounds, (err, hash) => {
  if (err) throw err;
  console.log("HASH DA SENHA (copie e cole no INSERT abaixo):");
  console.log(hash);
});