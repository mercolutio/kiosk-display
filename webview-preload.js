// Scroll-Simulation für Touchscreen ohne natives Scroll
(function() {
  var startY = null, lastY = null, scrolling = false, isDown = false;

  function down(y) {
    startY = y; lastY = y; scrolling = false; isDown = true;
    console.log('KIOSK:interaction');
  }

  function move(y, e) {
    if (!isDown || lastY === null) return;
    var dy = lastY - y;
    if (!scrolling && Math.abs(y - startY) > 5) scrolling = true;
    if (scrolling) {
      window.scrollBy(0, dy);
      try { e.preventDefault(); } catch(x) {}
      console.log('KIOSK:interaction');
    }
    lastY = y;
  }

  function up() {
    startY = null; lastY = null; scrolling = false; isDown = false;
  }

  // Pointer Events
  document.addEventListener('pointerdown', function(e) { down(e.clientY); }, true);
  document.addEventListener('pointermove', function(e) { if (isDown) move(e.clientY, e); }, true);
  document.addEventListener('pointerup', up, true);

  // Mouse Events
  document.addEventListener('mousedown', function(e) { down(e.clientY); }, true);
  document.addEventListener('mousemove', function(e) { move(e.clientY, e); }, true);
  document.addEventListener('mouseup', up, true);

  // Touch Events
  document.addEventListener('touchstart', function(e) { down(e.touches[0].clientY); }, true);
  document.addEventListener('touchmove', function(e) { move(e.touches[0].clientY, e); }, true);
  document.addEventListener('touchend', up, true);

  // Text-Selektion verhindern
  document.addEventListener('selectstart', function(e) {
    var t = (e.target.tagName || '').toLowerCase();
    if (t !== 'input' && t !== 'textarea') e.preventDefault();
  });

  console.log('KIOSK:scroll-sim-loaded');
})();
