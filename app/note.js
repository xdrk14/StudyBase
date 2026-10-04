// Loaded by each HTML note. Inside the StudyBase viewer the parent page handles theming;
// opened on its own, a note follows the saved theme (only Ultra darkens notes).
(function () {
  if (window.top !== window.self) return;
  var t = null;
  try { t = localStorage.getItem('sb-theme'); } catch (e) {}
  if (t !== 'ultra') return;
  var s = document.createElement('style');
  s.textContent = 'html{background:#000;filter:invert(1) hue-rotate(180deg)}img,video,picture{filter:invert(1) hue-rotate(180deg)}';
  document.head.appendChild(s);
})();
