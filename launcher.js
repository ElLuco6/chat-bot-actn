(()=> {
  const mount = () => {
    const containerId = 'actn-chatbot';
    let host = document.currentScript?.dataset?.host || '';
    if (!host) {
      const cfg = document.getElementById(containerId);
      host = cfg?.dataset?.host || ''; // ex: https://bot.actn.fr
    }
    if (!host) return console.warn('ACTN bot: host missing');

    const color = '#1f6feb', brand='ACTN';

    // bouton
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      position:'fixed', right:'18px', bottom:'18px', width:'56px', height:'56px',
      borderRadius:'999px', border:'0', background:color, color:'#fff', fontSize:'24px',
      zIndex: 99999, boxShadow:'0 8px 24px rgba(0,0,0,.25)', cursor:'pointer'
    });
    btn.title = `${brand} — Aide`; btn.textContent = '💬';
    document.body.appendChild(btn);

    // iframe
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position:'fixed', right:'18px', bottom:'84px', width:'360px', height:'560px',
      maxWidth:'92vw', maxHeight:'80vh', display:'none', zIndex:99998,
      borderRadius:'16px', overflow:'hidden', boxShadow:'0 12px 30px rgba(0,0,0,.25)'
    });
    const iframe = document.createElement('iframe');
    iframe.src = `${host}/widget.html`;
    Object.assign(iframe.style, { width:'100%', height:'100%', border:'0', background:'#fff' });
    wrap.appendChild(iframe);
    document.body.appendChild(wrap);

    btn.addEventListener('click', ()=> {
      wrap.style.display = (wrap.style.display==='none') ? 'block' : 'none';
    });
  };
  (document.readyState==='loading') ? document.addEventListener('DOMContentLoaded', mount) : mount();
})();
