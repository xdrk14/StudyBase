// Blocking, tiny: sets the theme before first paint so there is no flash.
(function () {
  var t = null;
  try { t = localStorage.getItem('sb-theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark' && t !== 'ultra') {
    t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', t);
})();
