/* Panel tilt for the about page's cockpit panels.
   Extracted from about-us.html so the CSP can drop 'unsafe-inline'.
   Predates the shared depthFX layer; behaviour preserved as-is. */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var panels = document.querySelectorAll('.cockpit-panel');

    panels.forEach(function (panel) {
      var isHovering = false;

      panel.addEventListener('mouseenter', function () {
        isHovering = true;
        this.style.transition = 'transform 0.1s ease-out, box-shadow 0.3s ease';
      });

      panel.addEventListener('mouseleave', function () {
        isHovering = false;
        this.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s ease';
        this.style.transform = 'translateY(0) translateZ(0) rotateX(0) rotateY(0)';
      });

      panel.addEventListener('mousemove', function (e) {
        if (!isHovering) return;

        var rect = this.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        var centerX = rect.width / 2;
        var centerY = rect.height / 2;

        var rotateX = ((y - centerY) / centerY) * -10;
        var rotateY = ((x - centerX) / centerX) * 10;

        this.style.transform =
          'perspective(1000px) translateY(-12px) translateZ(30px)' +
          ' rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg)';

        this.style.boxShadow =
          (-rotateY) + 'px ' + rotateX + 'px 30px rgba(0, 0, 0, 0.3),' +
          ' 0 0 80px var(--accent-a28),' +
          ' inset ' + ((x - centerX) / 10) + 'px ' + ((y - centerY) / 10) + 'px 60px var(--accent-a16)';
      });
    });
  });
})();
