---
impacto: nada_mudou
secao: corrigido
titulo: O link de confirmação de cadastro e de nova senha funciona com o e-mail padrão do Supabase
---

No plano grátis do Supabase, usando o envio de e-mail embutido dele, os modelos de e-mail não podem ser trocados, e o link padrão caía na tela de login com o aviso "configure os modelos de e-mail", que nem tinha como ser seguido. Agora o link padrão abre direto no mesmo navegador em que a pessoa se cadastrou ou pediu a nova senha. Aberto noutro aparelho, o cadastro diz que o e-mail foi confirmado e leva a pessoa a entrar (e, se veio de um convite, ao aceite dele); a nova senha explica que o link precisa ser aberto no navegador em que foi pedido.
