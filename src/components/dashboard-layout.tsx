'use client';
import { Children, cloneElement, isValidElement, useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, RotateCcw, Settings2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import {
  defaultDashboardLayout,
  layoutSections,
  normalizeDashboardLayout,
  type DashboardLayoutPreferences,
  type SectionId,
  type SectionWidth,
} from '@/lib/dashboard-layout';

export function useDashboardLayout(workspaceId: string) {
  const storageKey = `metatrack:dashboard-layout:v1:${workspaceId}`;
  const [preferences, setPreferences] = useState(defaultDashboardLayout);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    let next = defaultDashboardLayout();
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) next = normalizeDashboardLayout(JSON.parse(raw));
    } catch {
      /* A blocked or corrupt browser store must not prevent access to metrics. */
    }
    setPreferences(next);
    setReady(true);
  }, [storageKey]);
  function save(next: DashboardLayoutPreferences) {
    const normalized = normalizeDashboardLayout(next);
    let persisted = true;
    try {
      localStorage.setItem(storageKey, JSON.stringify(normalized));
    } catch {
      persisted = false;
    }
    setPreferences(normalized);
    return persisted;
  }
  return { preferences, ready, save };
}

export function LayoutSection({
  id,
  width = 'full',
  children,
}: {
  id: SectionId;
  width?: SectionWidth;
  children: ReactNode;
}) {
  return (
    <div className={`layout-section layout-width-${width}`} data-layout-section={id}>
      {children}
    </div>
  );
}
export function OverviewLayout({
  preferences,
  children,
}: {
  preferences: DashboardLayoutPreferences;
  children: ReactNode;
}) {
  const elements = Children.toArray(children).filter(
    isValidElement<{ id: SectionId; width?: SectionWidth }>,
  );
  return (
    <div
      className={`overview-layout layout-density-${preferences.density} layout-columns-${preferences.columns} layout-text-${preferences.textSize}`}
    >
      {preferences.sections
        .filter((section) => section.visible)
        .map((section) => {
          const element = elements.find((child) => child.props.id === section.id);
          return element ? cloneElement(element, { key: section.id, width: section.width }) : null;
        })}
    </div>
  );
}

export function DashboardLayoutSettings({
  controller,
  notify,
}: {
  controller: ReturnType<typeof useDashboardLayout>;
  notify: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(defaultDashboardLayout);
  function move(index: number, offset: number) {
    setDraft((current) => {
      const sections = [...current.sections];
      const target = index + offset;
      if (target < 0 || target >= sections.length) return current;
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...current, sections };
    });
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={!controller.ready}
        onClick={() => {
          setDraft(structuredClone(controller.preferences));
          setOpen(true);
        }}
      >
        <Settings2 size={16} />
        Personalizar painel
      </Button>
      {open && (
        <Modal
          title="Personalizar painel"
          onClose={() => setOpen(false)}
          className="layout-settings-modal"
        >
          <div className="layout-settings-heading">
            <div>
              <h2>Personalizar painel</h2>
              <p>Ajuste o tamanho, a ordem e os blocos da visão geral.</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Fechar personalização"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </Button>
          </div>
          <div className="layout-settings-options">
            <label className="form-label">
              Espaçamento
              <select
                aria-label="Espaçamento"
                value={draft.density}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    density: e.target.value as DashboardLayoutPreferences['density'],
                  })
                }
              >
                <option value="comfortable">Confortável</option>
                <option value="compact">Compacto</option>
              </select>
            </label>
            <label className="form-label">
              Cards por linha no computador
              <select
                aria-label="Cards por linha no computador"
                value={draft.columns}
                onChange={(e) =>
                  setDraft({ ...draft, columns: Number(e.target.value) as 2 | 3 | 4 })
                }
              >
                <option value="2">2 · grandes</option>
                <option value="3">3 · médios</option>
                <option value="4">4 · menores</option>
              </select>
            </label>
            <label className="form-label">
              Tamanho dos valores
              <select
                aria-label="Tamanho dos valores"
                value={draft.textSize}
                onChange={(e) =>
                  setDraft({ ...draft, textSize: e.target.value as 'normal' | 'large' })
                }
              >
                <option value="normal">Normal</option>
                <option value="large">Grande</option>
              </select>
            </label>
          </div>
          <p className="layout-settings-hint">
            As setas mudam a posição. Desmarque para ocultar. No celular, os blocos ficam em uma
            coluna.
          </p>
          <ol className="layout-settings-list">
            {draft.sections.map((section, index) => {
              const label = layoutSections.find((s) => s.id === section.id)!.label;
              return (
                <li key={section.id}>
                  <label className="layout-visibility">
                    <input
                      type="checkbox"
                      checked={section.visible}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          sections: draft.sections.map((s) =>
                            s.id === section.id ? { ...s, visible: e.target.checked } : s,
                          ),
                        })
                      }
                    />
                    {label}
                  </label>
                  <select
                    aria-label={`Largura de ${label}`}
                    value={section.width}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        sections: draft.sections.map((s) =>
                          s.id === section.id ? { ...s, width: e.target.value as SectionWidth } : s,
                        ),
                      })
                    }
                  >
                    <option value="full">Linha inteira</option>
                    <option value="wide">2/3 da linha</option>
                    <option value="half">Metade da linha</option>
                    <option value="narrow">1/3 da linha</option>
                  </select>
                  <div className="layout-move-buttons">
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={index === 0}
                      aria-label={`Mover ${label} para cima`}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={15} />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={index === draft.sections.length - 1}
                      aria-label={`Mover ${label} para baixo`}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={15} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="layout-settings-hint">
            Preferências salvas neste navegador, separadas por workspace. Blocos sem dados podem
            aparecer após a integração carregar.
          </p>
          <div className="layout-settings-footer">
            <Button variant="ghost" onClick={() => setDraft(defaultDashboardLayout())}>
              <RotateCcw size={15} />
              Restaurar padrão
            </Button>
            <div>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                disabled={!draft.sections.some((s) => s.visible)}
                onClick={() => {
                  const persisted = controller.save(draft);
                  setOpen(false);
                  notify(
                    persisted
                      ? 'Layout salvo neste navegador.'
                      : 'Layout aplicado nesta sessão. O navegador bloqueou o salvamento.',
                  );
                }}
              >
                <Check size={15} />
                Salvar layout
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
