/**
 * O telefone como a recepção digita → como `contacts.phone_number` guarda (E.164 com `+`).
 *
 * A recepção escreve "(11) 98888-7777", "11 98888 7777" ou "+55 11 98888-7777". Sem o DDI,
 * o número é brasileiro (a clínica atende no Brasil): 10 ou 11 dígitos ganham o 55 na frente.
 * Devolve `null` quando não dá para ser telefone, para a tela dizer isso antes de salvar.
 */
export function telefoneParaE164(texto: string): string | null {
  const limpo = texto.trim();
  if (limpo === "") return null;
  const digitos = limpo.replace(/\D/g, "");
  if (limpo.startsWith("+"))
    return digitos.length >= 8 && digitos.length <= 15 ? `+${digitos}` : null;
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`;
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13))
    return `+${digitos}`;
  return null;
}
