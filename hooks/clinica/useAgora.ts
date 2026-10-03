"use client";
import * as React from "react";

/** O relógio da tela anda sozinho: a falta libera e o atraso aparece sem recarregar. */
export function useAgora(intervaloMs = 30_000): Date {
  const [agora, setAgora] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), intervaloMs);
    return () => window.clearInterval(id);
  }, [intervaloMs]);
  return agora;
}
