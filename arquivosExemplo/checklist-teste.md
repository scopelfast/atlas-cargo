# Checklist de teste — som alerta / chat / SOS

## Antes

- [ ] Navegador Chrome ou Edge atualizado  
- [ ] Usuário logado na Torre / Dashboard  
- [ ] Volume do PC ligado  
- [ ] Aba do Atlas Cargo em foco (primeiro teste)

## Liberar áudio

- [ ] Clicar em qualquer lugar da tela após o login  
- [ ] (Opcional) Abrir `demo-som-notificacao.html` e clicar em **Liberar áudio**

## Preferência

No DevTools (F12) → Console:

```js
localStorage.getItem('notificacao_som')
// deve ser null ou 'true' (não 'false')
```

Se estiver `'false'`:

```js
localStorage.setItem('notificacao_som', 'true')
```

## Cenários

### Alerta
- [ ] Gerar / receber um **novo** alerta  
- [ ] Badge de alertas sobe  
- [ ] Bip ~ agudo médio (800 Hz)

### Chat
- [ ] Motorista envia mensagem no chat  
- [ ] Bip mais grave (600 Hz)  
- [ ] Mensagem da torre/operador **não** deve bipar (só motorista)

### SOS
- [ ] Disparar SOS de teste  
- [ ] Bip mais agudo (1000 Hz) + destaque visual

## Se não tocar

1. Clicou na página depois do login?  
2. `notificacao_som` está `false`?  
3. Aba silenciada no Chrome (ícone de alto-falante)?  
4. Socket conectado? (Network → WS / socket.io)  
5. Testar a demo HTML isolada — se a demo toca e o sistema não, o problema é socket/evento, não o áudio do PC.
