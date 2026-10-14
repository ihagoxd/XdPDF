/* ============================================================
   Arrastar para reordenar — mouse e toque.

   Mouse: arrasta assim que o ponteiro anda alguns pixels.
   Toque: segure o dedo ~0,3 s (vibra de leve) e arraste. Um deslize
   rápido continua rolando a tela normalmente.
   ============================================================ */
import { useEffect, useRef } from './lib.js';

const ESPERA_TOQUE = 280;
const TOLERANCIA = 8;

/**
 * @param {object} cfg
 * @param {{current: HTMLElement}} cfg.container  elemento que contém os itens
 * @param {string[]} cfg.ordem                     ids na ordem atual
 * @param {(nova: string[]) => void} cfg.aoMudar  chamado durante o arraste
 * @param {(nova: string[]) => void} [cfg.aoSoltar]
 * @param {boolean} [cfg.ativo]
 */
export function useOrdenavel({ container, ordem, aoMudar, aoSoltar, ativo = true }) {
  const estado = useRef({});
  const ordemRef = useRef(ordem);
  ordemRef.current = ordem;
  const cb = useRef({ aoMudar, aoSoltar });
  cb.current = { aoMudar, aoSoltar };

  useEffect(() => {
    const raiz = container.current;
    if (!raiz || !ativo) return undefined;
    const s = estado.current;

    const rolagem = () => raiz.closest('.principal') || document.scrollingElement;

    function limpar() {
      clearTimeout(s.timer);
      if (s.flutuante) s.flutuante.remove();
      if (s.el) s.el.classList.remove('fantasma');
      document.body.classList.remove('arrastando-item');
      cancelAnimationFrame(s.quadro);
      Object.keys(s).forEach((k) => { delete s[k]; });
    }

    function comecar() {
      s.ativo = true;
      const r = s.el.getBoundingClientRect();
      s.dx = s.x0 - r.left;
      s.dy = s.y0 - r.top;
      const clone = s.el.cloneNode(true);
      clone.classList.add('flutuando');
      clone.style.width = `${r.width}px`;
      clone.style.height = `${r.height}px`;
      clone.style.left = `${r.left}px`;
      clone.style.top = `${r.top}px`;
      clone.removeAttribute('data-id');
      document.body.appendChild(clone);
      s.flutuante = clone;
      s.el.classList.add('fantasma');
      document.body.classList.add('arrastando-item');
      if (s.toque && navigator.vibrate) navigator.vibrate(12);
      rolarSozinho();
    }

    function mover(x, y) {
      s.x = x; s.y = y;
      if (!s.ativo) return;
      s.flutuante.style.left = `${x - s.dx}px`;
      s.flutuante.style.top = `${y - s.dy}px`;

      // acha o item mais perto do ponteiro e decide antes/depois dele
      const itens = Array.from(raiz.querySelectorAll('[data-id]'));
      let melhor = null;
      let menor = Infinity;
      for (const el of itens) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = (x - cx) ** 2 + ((y - cy) * 1.4) ** 2;
        if (d < menor) { menor = d; melhor = { el, r, cx }; }
      }
      if (!melhor) return;
      const alvo = melhor.el.dataset.id;
      if (alvo === s.id) return;
      const atual = ordemRef.current.slice();
      const de = atual.indexOf(s.id);
      if (de < 0) return;
      atual.splice(de, 1);
      let para = atual.indexOf(alvo);
      if (x > melhor.cx) para += 1;
      atual.splice(para, 0, s.id);
      if (atual.join('|') !== ordemRef.current.join('|')) {
        ordemRef.current = atual;
        cb.current.aoMudar(atual);
      }
    }

    // perto da borda, a tela rola sozinha
    function rolarSozinho() {
      if (!s.ativo) return;
      const el = rolagem();
      if (el && s.y != null) {
        const r = el === document.scrollingElement ? { top: 0, bottom: innerHeight } : el.getBoundingClientRect();
        const borda = 70;
        if (s.y < r.top + borda) el.scrollTop -= Math.ceil((r.top + borda - s.y) / 6);
        else if (s.y > r.bottom - borda) el.scrollTop += Math.ceil((s.y - (r.bottom - borda)) / 6);
      }
      s.quadro = requestAnimationFrame(rolarSozinho);
    }

    function terminar() {
      const fez = s.ativo;
      const nova = ordemRef.current;
      limpar();
      if (fez && cb.current.aoSoltar) cb.current.aoSoltar(nova);
      if (fez) {
        // o clique que vem depois de soltar não deve abrir nada
        const engolir = (e) => { e.stopPropagation(); e.preventDefault(); };
        window.addEventListener('click', engolir, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', engolir, { capture: true }), 50);
      }
    }

    function aoApertar(e) {
      if (e.button !== undefined && e.button !== 0) return;
      const el = e.target.closest('[data-id]');
      if (!el || !raiz.contains(el)) return;
      if (e.target.closest('button, a, input, select, textarea, [data-sem-arrastar]')) return;
      limpar();
      s.id = el.dataset.id;
      s.el = el;
      s.x0 = e.clientX; s.y0 = e.clientY;
      s.x = e.clientX; s.y = e.clientY;
      s.toque = e.pointerType !== 'mouse';
      if (s.toque) s.timer = setTimeout(() => { if (s.el) comecar(); }, ESPERA_TOQUE);
    }

    function aoMoverPonteiro(e) {
      if (!s.el) return;
      if (!s.ativo) {
        const andou = Math.hypot(e.clientX - s.x0, e.clientY - s.y0);
        if (s.toque) {
          if (andou > TOLERANCIA) limpar(); // estava rolando a tela
          return;
        }
        if (andou > 5) comecar(); else return;
      }
      mover(e.clientX, e.clientY);
    }

    function aoMoverToque(e) {
      if (!s.ativo) return;
      e.preventDefault(); // segura a rolagem enquanto arrasta
      const t = e.touches[0];
      if (t) mover(t.clientX, t.clientY);
    }

    function aoCancelar() {
      // no toque, o navegador cancela o ponteiro ao começar a rolar
      if (!s.ativo) limpar();
    }

    const semMenu = (e) => { if (s.el) e.preventDefault(); };
    const aoSoltarToque = () => { if (s.ativo) terminar(); };

    raiz.addEventListener('pointerdown', aoApertar);
    raiz.addEventListener('contextmenu', semMenu);
    window.addEventListener('pointermove', aoMoverPonteiro);
    window.addEventListener('pointerup', terminar);
    window.addEventListener('pointercancel', aoCancelar);
    window.addEventListener('touchmove', aoMoverToque, { passive: false });
    window.addEventListener('touchend', aoSoltarToque);

    return () => {
      limpar();
      raiz.removeEventListener('pointerdown', aoApertar);
      raiz.removeEventListener('contextmenu', semMenu);
      window.removeEventListener('pointermove', aoMoverPonteiro);
      window.removeEventListener('pointerup', terminar);
      window.removeEventListener('pointercancel', aoCancelar);
      window.removeEventListener('touchmove', aoMoverToque);
      window.removeEventListener('touchend', aoSoltarToque);
    };
  }, [container.current, ativo]);
}
