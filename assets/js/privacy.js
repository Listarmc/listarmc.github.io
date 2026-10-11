/*
 * privacy.js — Privacy Policy page only
 * Loaded as a classic script at the end of <body>.
 */

// Toggle function for mobile navigation menu
function toggleNav() {
    var x = document.getElementById("myNavbar");
    if (x.className === "navbar") {
        x.className += " responsive";
    } else {
        x.className = "navbar";
    }
}

document.querySelectorAll('.packs-grid .pack').forEach(pack => {
    pack.addEventListener('click', function() {
        const href = this.getAttribute('data-href');
        if (href) {
            window.location.href = href;
        }
    });
});

// Search functionality
document.getElementById('search-input').addEventListener('input', function() {
    const query = this.value.toLowerCase();
    const packs = document.querySelectorAll('.packs-grid .pack');

    packs.forEach(function(pack) {
        const name = pack.getAttribute('data-name').toLowerCase();
        if (name.includes(query)) {
            pack.style.display = 'block';
        } else {
            pack.style.display = 'none';
        }
    });
});
