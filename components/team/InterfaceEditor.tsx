"use client";
import { useT } from "@/hooks/i18n/useT";
import { useId } from "react";
import { MENUS_POR_CARGO, cargoDaInterface, interfaceDoCargo } from "@/lib/clinica/menus-por-cargo";
import type { Role } from "@/lib/auth/types";
import { NAV_GROUPS, type NavDestinationId } from "@/lib/navigation/catalogo";
import {
  destinosDaInterface,
  essencial,
  interfaceTemDestino,
  lerInterface,
  permitidos,
  type InterfaceSettings,
} from "@/lib/navigation/interface";

export function InterfaceEditor({
  value,
  onChange,
  role,
  disabled = false,
  menusDaClinica = false,
}: {
  value: InterfaceSettings;
  onChange: (value: InterfaceSettings) => void;
  role: Role;
  disabled?: boolean;
  /** Fork TOQ: com o módulo clínica ligado, oferece o menu pronto de cada cargo. */
  menusDaClinica?: boolean;
}) {
  const t = useT();
  const id = useId();
  const selected = new Set<string>(
    value.destinos ?? destinosDaInterface(value, false, role).map((d) => d.href),
  );
  const options = permitidos(false, role).filter((d) => !essencial(d, role));
  const cargoAtual = cargoDaInterface(value);
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-md border p-4">
      <legend className="px-1 text-sm font-medium">{t("Interface")}</legend>
      <p className="text-xs text-muted-foreground">
        {t(
          "Define quais áreas aparecem na navegação. As permissões continuam sendo determinadas pelo papel. Links de conversas e avisos podem abrir áreas autorizadas que estejam ocultas.",
        )}
      </p>
      {menusDaClinica ? (
        <div className="space-y-2" data-testid="menus-por-cargo">
          <p className="text-sm font-medium">{t("Menu pronto por cargo")}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {MENUS_POR_CARGO.map((menu) => (
              <button
                key={menu.id}
                type="button"
                data-testid={`cargo-${menu.id}`}
                aria-pressed={cargoAtual === menu.id}
                onClick={() => onChange(interfaceDoCargo(menu.id))}
                className={`rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted ${
                  cargoAtual === menu.id ? "border-primary bg-primary/5" : ""
                }`}
              >
                <span className="block font-medium">{t(menu.rotulo)}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t(menu.descricao)}
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "O menu da pessoa fica só com o que ela usa no dia. Dá para ajustar área por área logo abaixo.",
            )}
          </p>
        </div>
      ) : null}
      <label htmlFor={id} className="block text-sm">
        {t("Perfil de interface")}
      </label>
      <select
        id={id}
        value={value.preset}
        onChange={(e) => onChange({ preset: e.target.value as InterfaceSettings["preset"] })}
        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
      >
        <option value="completa">{t("Completa")}</option>
        <option value="simplificada">{t("Simplificada")}</option>
      </select>
      <p className="text-xs text-muted-foreground">
        {t(
          "Trocar o perfil restaura sua seleção padrão. Perfil, segurança e acesso à equipe de quem administra continuam disponíveis.",
        )}
      </p>
      {lerInterface(value).needsAdjustment && (
        <p role="status" className="text-sm">
          {t("A seleção contém áreas antigas. Confira e salve novamente.")}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          {t("Personalizar áreas visíveis")}
          {value.destinos ? t(" (personalizada)") : ""}
        </summary>
        <div className="mt-3 max-h-64 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map((group) => {
            const items = options.filter((d) => d.group === group.id);
            if (!items.length) return null;
            return (
              <fieldset key={group.id} className="space-y-2">
                <legend className="mb-2 text-xs font-medium text-muted-foreground uppercase">
                  {t(group.label)}
                </legend>
                {items.map((d) => (
                  <label key={d.href} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(d.href)}
                      onChange={(e) => {
                        const next = new Set(
                          options
                            .filter((option) => selected.has(option.href))
                            .map((option) => option.href),
                        );
                        if (e.target.checked) next.add(d.href);
                        else next.delete(d.href);
                        onChange({
                          preset: value.preset,
                          destinos: [...next] as NavDestinationId[],
                        });
                      }}
                      className="mt-1"
                    />
                    {t(d.label)}
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
      </details>
      {!interfaceTemDestino(value, role) || value.destinos?.length === 0 ? (
        <p role="alert" className="text-sm text-destructive">
          {t("Selecione ao menos uma área de trabalho permitida ao papel.")}
        </p>
      ) : null}
    </fieldset>
  );
}
