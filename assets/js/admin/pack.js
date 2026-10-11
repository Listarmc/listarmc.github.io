/*
 * pack.js — behaviour for individual pack pages (Packs/*.html)
 * Mobile menu, ad-blocker notice, support reminder, screenshot lightbox.
 * Loaded as a classic script at the end of <body>: the inline onclick handlers in
 * the page (openModal, currentSlide, plusSlides, closeModal, dismiss*, reEnableAds)
 * rely on these functions being globals, and showSlides() runs immediately.
 */

// Run ad block detection immediately when the page loads
document.addEventListener('DOMContentLoaded', function() {
    // Run ad block detection first, before other initialization
    checkForAdBlocker();

    // Mobile menu toggle functionality
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const navList = document.getElementById('nav-list');

    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', function() {
            navList.classList.toggle('active');
        });
    }

    // Show support reminder if applicable
    showSupportReminder();
});

// ---------------------------------------------------------------- ad-blocker notice

// Function to check for ad blocker - improved detection with multiple methods
function checkForAdBlocker() {
    // Skip check if user previously dismissed
    if (localStorage.getItem('adblock_dismissed') === 'true') {
        return;
    }

    // Create multiple bait elements with different ad-related class names
    const baitClasses = [
        'ad-placement ad-banner adsbox',
        'advertisement ad-box ad-slot',
        'banner-ad ad-unit ad-zone',
        'sponsored-content advert-container',
        'pub_300x250 pub_300x250m pub_728x90 text-ad textAd'
    ];

    let detectionCount = 0;
    const baitElements = [];

    // Create and append multiple bait elements
    baitClasses.forEach((className, index) => {
        const bait = document.createElement('div');
        bait.className = className;
        bait.style.height = '1px';
        bait.style.width = '1px';
        bait.style.position = 'absolute';
        bait.style.left = '-10000px';
        bait.style.top = '-1000px';
        bait.style.zIndex = '-1';
        bait.textContent = ' ';
        bait.setAttribute('aria-hidden', 'true');
        bait.id = 'ad-bait-' + index;
        document.body.appendChild(bait);
        baitElements.push(bait);
    });

    // Create a fake ad iframe as an additional check
    const adFrame = document.createElement('iframe');
    adFrame.id = 'ad-frame-bait';
    adFrame.src = 'about:blank';
    adFrame.style.display = 'none';
    adFrame.style.width = '1px';
    adFrame.style.height = '1px';
    document.body.appendChild(adFrame);
    baitElements.push(adFrame);

    // Check if the bait elements were hidden by an ad blocker
    setTimeout(function() {
        baitElements.forEach(bait => {
            let isBlocked = false;

            // Different checks for iframe vs div elements
            if (bait.tagName.toLowerCase() === 'iframe') {
                // Check if iframe was blocked
                try {
                    const iframeDoc = bait.contentDocument || bait.contentWindow.document;
                    if (!iframeDoc) isBlocked = true;
                } catch (e) {
                    // If we can't access the iframe, it might be blocked
                    isBlocked = true;
                }
            } else {
                // Check if div was hidden or removed
                if (bait.offsetHeight === 0 || 
                    bait.offsetLeft === 0 || 
                    bait.offsetTop === 0 || 
                    bait.offsetWidth === 0 || 
                    bait.clientHeight === 0 || 
                    bait.clientWidth === 0) {
                    isBlocked = true;
                }

                if (window.getComputedStyle(bait).display === 'none' ||
                    window.getComputedStyle(bait).visibility === 'hidden' ||
                    window.getComputedStyle(bait).opacity === '0') {
                    isBlocked = true;
                }
            }

            if (isBlocked) detectionCount++;

            // Clean up
            if (bait.parentNode) {
                bait.parentNode.removeChild(bait);
            }
        });

        // Only show message if multiple bait elements were blocked (more reliable detection)
        if (detectionCount >= 3) {
            console.log('Ad blocker detected with confidence');
            document.getElementById('adblock-message').style.display = 'block';
        }
    }, 500); // Increased timeout for more reliable detection
}

// Function to dismiss adblock message
function dismissAdblockMessage() {
    const adblockMessage = document.getElementById('adblock-message');
    adblockMessage.style.animation = 'fadeOut 0.4s ease-out forwards';

    // Add the fadeOut animation
    if (!document.querySelector('style#fadeout-style')) {
        const style = document.createElement('style');
        style.id = 'fadeout-style';
        style.textContent = `
            @keyframes fadeOut {
                from { opacity: 1; }
                to { opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    // Hide after animation completes
    setTimeout(() => {
        adblockMessage.style.display = 'none';

        // Show the support reminder immediately after dismissing
        document.getElementById('support-reminder').style.display = 'block';
    }, 400);

    // Set localStorage to remember user's choice
    localStorage.setItem('adblock_dismissed', 'true');
    localStorage.setItem('reminder_last_shown', new Date().getTime().toString());
}

// ---------------------------------------------------------------- support reminder

// Function to show support reminder
function showSupportReminder() {
    // Only show if user has dismissed adblock message
    if (localStorage.getItem('adblock_dismissed') === 'true') {
        // Initial display after a short delay
        setTimeout(() => {
            document.getElementById('support-reminder').style.display = 'block';
        }, 3000); // Show after 3 seconds

        // Set up periodic reminders
        setUpPeriodicReminders();
    }
}

// Function to set up periodic reminders
function setUpPeriodicReminders() {
    // Check if we should show periodic reminders
    if (localStorage.getItem('reminder_last_shown')) {
        const lastShown = parseInt(localStorage.getItem('reminder_last_shown'));
        const now = new Date().getTime();

        // If it's been more than 30 seconds since last shown, show it again
        if (now - lastShown > 30 * 1000) {
            showReminderWithDelay();
        }
    } else {
        // First time, just record when it was shown
        localStorage.setItem('reminder_last_shown', new Date().getTime().toString());
    }

    // Also show reminder when user scrolls to bottom of page
    window.addEventListener('scroll', handleScroll);

    // Add event listener for mouse movement to occasionally show reminder
    window.addEventListener('mousemove', handleMouseMove);
}

// Variable to track last mouse movement check
let lastMouseCheck = 0;
let mouseCheckInterval = 10000; // 10 seconds between checks

// Function to handle mouse movement
function handleMouseMove(e) {
    const now = new Date().getTime();

    // Only check occasionally to avoid performance issues
    if (now - lastMouseCheck < mouseCheckInterval) return;

    lastMouseCheck = now;

    // 20% chance to show reminder on mouse movement check
    if (Math.random() < 0.20 && document.getElementById('support-reminder').style.display !== 'block') {
        document.getElementById('support-reminder').style.display = 'block';
        localStorage.setItem('reminder_last_shown', now.toString());
    }
}

// Function to handle scroll
function handleScroll() {
    // Check if user has scrolled to the bottom of the page
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 300) {
        if (document.getElementById('support-reminder').style.display !== 'block') {
            document.getElementById('support-reminder').style.display = 'block';
            localStorage.setItem('reminder_last_shown', new Date().getTime().toString());
        }
    }
}

// Function to show reminder with a delay
function showReminderWithDelay() {
    setTimeout(() => {
        document.getElementById('support-reminder').style.display = 'block';
        localStorage.setItem('reminder_last_shown', new Date().getTime().toString());
    }, 2000); // Show after 2 seconds
}

// Function to dismiss support reminder temporarily
function dismissSupportReminder() {
    document.getElementById('support-reminder').style.display = 'none';
    // Just dismiss for now, will show again later
    localStorage.setItem('reminder_last_shown', new Date().getTime().toString());
}

// Function to re-enable ads
function reEnableAds() {
    localStorage.removeItem('adblock_dismissed');
    localStorage.removeItem('reminder_last_shown');
    location.reload();
}

// ---------------------------------------------------------------- screenshot lightbox

// Modal functionality
function openModal() {
    document.getElementById("myModal").style.display = "block";
    document.body.style.overflow = "hidden"; // Prevent scrolling when modal is open
}

function closeModal() {
    document.getElementById("myModal").style.display = "none";
    document.body.style.overflow = "auto"; // Re-enable scrolling
}

var slideIndex = 1;
showSlides(slideIndex);

function plusSlides(n) {
    showSlides(slideIndex += n);
}

function currentSlide(n) {
    showSlides(slideIndex = n);
}

function showSlides(n) {
    var i;
    var slides = document.getElementsByClassName("mySlides");
    if (!slides.length) return;
    if (n > slides.length) {slideIndex = 1}
    if (n < 1) {slideIndex = slides.length}
    for (i = 0; i < slides.length; i++) {
        slides[i].style.display = "none";
    }
    if (!slides.length) return;
    slides[slideIndex-1].style.display = "flex";
}

// Match preview thumbnails to their actual screenshot even when a pack uses
// a curated selection/order different from the full gallery.
document.querySelectorAll('.thumbnails-grid .thumbnail-item').forEach((thumb, i) => {
    thumb.addEventListener('click', e => {
        const src = thumb.querySelector('img')?.src;
        const slides = [...document.querySelectorAll('#myModal .mySlides img')];
        const match = slides.findIndex(img => img.src === src);
        if (match >= 0) {
            e.preventDefault();
            e.stopImmediatePropagation();
            openModal();
            currentSlide(match + 1);
        }
    }, true);
});

// Close on backdrop clicks without overriding unrelated window click handlers.
const galleryModal = document.getElementById('myModal');
if (galleryModal) {
    galleryModal.addEventListener('click', (event) => {
        if (event.target === galleryModal) closeModal();
    });

    // Trackpad/mouse-wheel navigation: one step per deliberate scroll gesture.
    let lastWheelNavigation = 0;
    galleryModal.addEventListener('wheel', (event) => {
        if (galleryModal.style.display !== 'block') return;
        if (Math.abs(event.deltaY) < 8 && Math.abs(event.deltaX) < 8) return;
        event.preventDefault();
        const now = performance.now();
        if (now - lastWheelNavigation < 420) return;
        lastWheelNavigation = now;
        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        plusSlides(delta > 0 ? 1 : -1);
    }, { passive: false });

    // Swipe left/right on touch screens; ignore primarily vertical swipes.
    let touchStartX = null;
    let touchStartY = null;
    galleryModal.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 1) return;
        touchStartX = event.touches[0].clientX;
        touchStartY = event.touches[0].clientY;
    }, { passive: true });
    galleryModal.addEventListener('touchend', (event) => {
        if (touchStartX === null || !event.changedTouches.length) return;
        const deltaX = event.changedTouches[0].clientX - touchStartX;
        const deltaY = event.changedTouches[0].clientY - touchStartY;
        touchStartX = touchStartY = null;
        if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
            plusSlides(deltaX < 0 ? 1 : -1);
        }
    }, { passive: true });
}

// Add keyboard navigation for modal
document.addEventListener('keydown', function(e) {
    if (document.getElementById("myModal").style.display === "block") {
        if (e.key === "ArrowLeft") {
            plusSlides(-1);
        } else if (e.key === "ArrowRight") {
            plusSlides(1);
        } else if (e.key === "Escape") {
            closeModal();
        }
    }
});
