/** Direct manipulation stays exact; only the outline stretches and the release springs. */
let preferred: { width: number; height: number } | null = null;
export const markerSize = () => preferred;
const quiet = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function bindResize(card: HTMLElement, onResize: () => void) {
  let spring: Animation | undefined;
  const bounds = () => new DOMRect(card.offsetLeft, card.offsetTop, card.offsetWidth, card.offsetHeight);
  for (const edge of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = `wsresize wsresize-${edge}`;
    handle.setAttribute('aria-label', `Resize marker ${ {n:'top',e:'right',s:'bottom',w:'left',ne:'top right',se:'bottom right',sw:'bottom left',nw:'top left'}[edge] }`);
    handle.title = 'Drag to resize · arrow keys to adjust · double-click to reset';
    card.append(handle);
    const size = (r: DOMRect, dx: number, dy: number) => {
      card.classList.add('resized');
      const right = innerWidth - 8, bottom = (visualViewport?.height || innerHeight) - 8;
      const minW = Math.min(320, right - 8), minH = Math.min(280, bottom - 64);
      let l = r.left, t = r.top, rr = r.right, b = r.bottom;
      if (edge.includes('e')) rr = Math.min(right, Math.max(l + minW, r.right + dx));
      if (edge.includes('w')) l = Math.max(8, Math.min(rr - minW, r.left + dx));
      if (edge.includes('s')) b = Math.min(bottom, Math.max(t + minH, r.bottom + dy));
      if (edge.includes('n')) t = Math.max(64, Math.min(b - minH, r.top + dy));
      Object.assign(card.style, {left:`${l}px`,top:`${t}px`,width:`${rr-l}px`,height:`${b-t}px`});
      preferred = {width:rr-l,height:b-t};
      onResize();
    };
    handle.onpointerdown = e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation(); spring?.cancel();
      card.style.transformOrigin = `${edge.includes('w') ? 'right' : edge.includes('e') ? 'left' : 'center'} ${edge.includes('n') ? 'bottom' : edge.includes('s') ? 'top' : 'center'}`;
      const r = bounds(), x = e.clientX, y = e.clientY;
      let lastX = x, lastY = y;
      handle.setPointerCapture(e.pointerId);
      card.classList.add('resized', 'resizing');
      handle.classList.add('pulling');
      handle.onpointermove = ev => {
        size(r, ev.clientX-x, ev.clientY-y);
        if (!quiet()) card.style.setProperty('--pull', `${Math.min(9, Math.hypot(ev.clientX-lastX,ev.clientY-lastY)*.25)}px`);
        lastX=ev.clientX; lastY=ev.clientY;
      };
      const finish = () => {
        handle.onpointermove = null; handle.onpointerup = null; handle.onpointercancel = null; handle.onlostpointercapture = null;
        card.classList.remove('resizing'); handle.classList.remove('pulling'); card.style.removeProperty('--pull');
        if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
        if (!quiet() && card.isConnected) spring = card.animate([
          {scale:'1.012 1.008'}, {scale:'.996 .998',offset:.55}, {scale:'1'}
        ], {duration:330,easing:'cubic-bezier(.22,.75,.3,1)'});
      };
      handle.onpointerup = finish; handle.onpointercancel = finish; handle.onlostpointercapture = finish;
    };
    handle.onkeydown = e => {
      const delta: Record<string,number[]> = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
      if (!delta[e.key]) return;
      e.preventDefault(); e.stopPropagation();
      spring?.cancel();
      const [x,y]=delta[e.key], step=e.shiftKey?40:12;
      size(bounds(),x*step,y*step);
    };
    handle.ondblclick = e => {
      e.preventDefault(); spring?.cancel();
      const width=Math.min(500,innerWidth-24), height=Math.min(680,(visualViewport?.height||innerHeight)-88);
      preferred=null;
      Object.assign(card.style,{width:`${width}px`,height:`${height}px`,left:`${Math.max(12,(innerWidth-width)/2)}px`,top:'72px'});
      onResize();
    };
  }
}
