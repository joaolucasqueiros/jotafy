'use client';
import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import GridLayout from 'react-grid-layout';
import { Grip, Move, Save, ArrowDown, ArrowUp, Check, RotateCcw, Settings2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import {
  canvasLayout,
  normalizeCanvas,
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(defaultDashboardLayout);
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
    setDraft(next);
    setEditing(false);
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
    setDraft(normalized);
    setEditing(false);
    return persisted;
  }
  return {
    preferences: editing ? draft : preferences,
    ready,
    save,
    editing,
    begin: () => {
      setDraft(structuredClone(preferences));
      setEditing(true);
    },
    cancel: () => {
      setDraft(preferences);
      setEditing(false);
    },
    update: setDraft,
    apply: () => save(draft),
  };
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
    <div className={`layout-section layout-width-${width}`} data-layout-content={id}>
      {children}
    </div>
  );
}
export function OverviewLayout({
  controller,
  children,
}: {
  controller: ReturnType<typeof useDashboardLayout>;
  children: ReactNode;
}) {
  const { preferences, editing } = controller;
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const elements = Children.toArray(children).filter(
    isValidElement<{ id: SectionId; children: ReactNode }>,
  );
  const widgets: { id: string; sectionId: SectionId; label: string; content: ReactNode }[] = [];
  for (const section of preferences.sections.filter((s) => s.visible)) {
    const element = elements.find((child) => child.props.id === section.id);
    if (!element || !element.props.children) continue;
    const label = layoutSections.find((s) => s.id === section.id)!.label;
    if (
      section.id === 'metrics' &&
      isValidElement<{ children: ReactNode }>(element.props.children)
    ) {
      Children.toArray(element.props.children.props.children).forEach((content, index) => {
        widgets.push({
          id: `metric-${index}`,
          sectionId: section.id,
          label: ['Faturamento', 'Investimento', 'ROAS', 'Lucro'][index],
          content,
        });
      });
    } else if (
      section.id === 'financials' &&
      isValidElement<{ children: ReactNode }>(element.props.children)
    ) {
      const parts = Children.toArray(element.props.children.props.children).filter(
        isValidElement<{ className?: string; children: ReactNode }>,
      );
      const cards = parts.find((part) => part.props.className === 'metric-grid');
      if (cards) {
        const heading = parts.find((part) => part.props.className === 'panel-heading');
        widgets.push({
          id: 'financial-intro',
          sectionId: section.id,
          label: 'Financeiro Cakto',
          content: <section className="panel">{heading}</section>,
        });
        Children.toArray(cards.props.children).forEach((content, index) => {
          const cardLabel = isValidElement(content)
            ? String(content.key || 'Financeiro').replace(/^\.\$/, '')
            : 'Financeiro';
          widgets.push({
            id: `financial-${index}`,
            sectionId: section.id,
            label: cardLabel,
            content,
          });
        });
        widgets.push({
          id: 'financial-details',
          sectionId: section.id,
          label: 'Produtos e pagamentos',
          content: (
            <section className="panel">
              {parts.filter((part) => part !== heading && part !== cards)}
            </section>
          ),
        });
      } else widgets.push({ id: section.id, sectionId: section.id, label, content: element });
    } else widgets.push({ id: section.id, sectionId: section.id, label, content: element });
  }
  const desktop = width > 900;
  const layout = canvasLayout(
    preferences,
    widgets.map((widget) => widget.id),
  );
  function changed(next: GridLayout.Layout[]) {
    controller.update((current) => ({
      ...current,
      canvas: normalizeCanvas([
        ...(current.canvas || []).filter((item) => !next.some((n) => n.i === item.i)),
        ...next,
      ]),
    }));
  }
  return (
    <div
      ref={container}
      className={`overview-layout canvas-dashboard layout-density-${preferences.density} layout-columns-${preferences.columns} layout-text-${preferences.textSize} ${editing ? 'canvas-editing' : ''}`}
    >
      {width > 0 && desktop ? (
        <GridLayout
          width={width}
          cols={12}
          rowHeight={24}
          margin={[16, 16]}
          containerPadding={[0, 0]}
          layout={layout.map((item) => ({ ...item, minW: 2, minH: 3, maxH: 80 }))}
          isDraggable={editing}
          isResizable={editing}
          draggableHandle=".canvas-drag-handle"
          resizeHandles={['se', 'e', 's']}
          onDragStop={changed}
          onResizeStop={changed}
          compactType="vertical"
          className="canvas-grid"
        >
          {widgets.map((widget) => (
            <div
              key={widget.id}
              className="canvas-widget"
              data-canvas-id={widget.id}
              data-layout-section={widget.sectionId}
            >
              {editing && (
                <div
                  className="canvas-drag-handle"
                  aria-label={`Arrastar ${widget.label}`}
                  title="Arraste para mover"
                >
                  <Grip size={16} />
                  <span>{widget.label}</span>
                  <Move size={14} />
                </div>
              )}
              <div className="canvas-widget-content">{widget.content}</div>
            </div>
          ))}
        </GridLayout>
      ) : (
        <div className="canvas-mobile-stack">
          {editing && (
            <p className="layout-settings-hint">
              Abra no computador para arrastar e redimensionar. As opções de exibição também
              funcionam no celular.
            </p>
          )}
          {widgets
            .slice()
            .sort((a, b) => {
              const aa = layout.find((item) => item.i === a.id)!;
              const bb = layout.find((item) => item.i === b.id)!;
              return aa.y - bb.y || aa.x - bb.x;
            })
            .map((widget) => (
              <div
                key={widget.id}
                className="canvas-mobile-widget"
                data-canvas-id={widget.id}
                data-layout-section={widget.sectionId}
              >
                {widget.content}
              </div>
            ))}
        </div>
      )}
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
      return { ...current, sections, canvas: undefined };
    });
  }
  return (
    <>
      {!controller.editing ? (
        <Button variant="outline" disabled={!controller.ready} onClick={controller.begin}>
          <Move size={16} />
          Editar layout visual
        </Button>
      ) : (
        <>
          <Button
            onClick={() => {
              const saved = controller.apply();
              notify(
                saved
                  ? 'Layout visual salvo neste navegador.'
                  : 'Layout aplicado; salvamento bloqueado pelo navegador.',
              );
            }}
          >
            <Save size={16} />
            Salvar layout visual
          </Button>
          <Button variant="outline" onClick={controller.cancel}>
            Cancelar edição
          </Button>
          <Button variant="ghost" onClick={() => controller.update(defaultDashboardLayout())}>
            <RotateCcw size={16} />
            Restaurar padrão
          </Button>
        </>
      )}
      {controller.editing && (
        <div className="canvas-editor-toolbar" role="region" aria-label="Edição visual do painel">
          <span>
            <Move size={17} />
            Arraste pela barra verde. Redimensione pelos cantos e bordas.
          </span>
          <Button variant="outline" onClick={controller.cancel}>
            Descartar alterações
          </Button>
          <Button
            onClick={() => {
              const saved = controller.apply();
              notify(
                saved
                  ? 'Layout visual salvo neste navegador.'
                  : 'Layout aplicado apenas nesta sessão.',
              );
            }}
          >
            <Save size={16} />
            Concluir edição
          </Button>
        </div>
      )}
      <Button
        variant="outline"
        disabled={!controller.ready}
        onClick={() => {
          setDraft(structuredClone(controller.preferences));
          setOpen(true);
        }}
      >
        <Settings2 size={16} />
        Opções de exibição
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
              <p>
                Ajuste a aparência e a visibilidade. Para mover e redimensionar, use Editar layout
                visual.
              </p>
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
                  setDraft({
                    ...draft,
                    canvas: undefined,
                    columns: Number(e.target.value) as 2 | 3 | 4,
                  })
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
                        canvas: undefined,
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
