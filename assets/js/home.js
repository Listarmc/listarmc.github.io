/*
 * home.js — home page behaviour (index.html)
 * Loaded as a classic script at the end of <body>.
 */

// ---------------------------------------------------------------- mobile menu + ad-block probe

document.addEventListener("DOMContentLoaded", function() {
    // Mobile menu toggle functionality
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const navList = document.getElementById('nav-list');

    if (mobileMenuToggle && navList) {
        mobileMenuToggle.addEventListener('click', function() {
            navList.classList.toggle('active');
            console.log('Mobile menu toggled');
        });
    }

    // Adblock detection
    setTimeout(function() {
        var adBlockEnabled = false;
        var testAd = document.createElement('div');
        testAd.innerHTML = '&nbsp;';
        testAd.className = 'adsbox';
        document.body.appendChild(testAd);
        window.setTimeout(function() {
            if (testAd.offsetHeight === 0) {
                adBlockEnabled = true;
            }
            testAd.remove();
            var adblockMsg = document.getElementById('adblock-message');
            if (adBlockEnabled && adblockMsg) {
                adblockMsg.style.display = 'block';
            }
        }, 100);
    }, 2000);
});

// ---------------------------------------------------------------- pack catalogue
// Search, filters, category tabs, sort, pagination, grid/list view and the
// "Featured Packs" carousel. Every pack is a .pack-card in #packs-container;
// this code only shows/hides and reorders those cards.

document.addEventListener("DOMContentLoaded", function() {
  const ITEMS_PER_PAGE = 9;
  let currentPage = 1;

  const packsContainer = document.getElementById('packs-container');
  const packCount = document.getElementById('pack-count');
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  const prevPageBtn = document.getElementById('prev-page');
  const nextPageBtn = document.getElementById('next-page');
  const versionFilter = document.getElementById('version-filter');
  const themeFilter = document.getElementById('theme-filter');
  const scaleFilter = document.getElementById('scale-filter');
  const sortSelect = document.getElementById('sort-select');
  const categoryTabs = document.querySelectorAll('.category-tab');
  const viewButtons = document.querySelectorAll('.view-btn');
  const jumpPageInput = document.getElementById('jump-page-input');
  const paginationJumpContainer = document.getElementById('pagination-jump');

  const state = {
    search: '',
    version: versionFilter ? versionFilter.value : 'all',
    theme: themeFilter ? themeFilter.value.toLowerCase() : 'all',
    scale: scaleFilter ? scaleFilter.value : 'all',
    category: document.querySelector('.category-tab.active')?.getAttribute('data-category') || 'all',
    sort: sortSelect ? sortSelect.value : 'newest'
  };

  function getAllCards() {
    return Array.from(packsContainer.querySelectorAll('.pack-card'));
  }

  function normaliseText(value) {
    return (value || '').toString().trim().toLowerCase();
  }

  function parseCardDate(card) {
    const raw = card.getAttribute('data-date') || '2000-01-01';
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? new Date('2000-01-01') : date;
  }

  function getCardDownloads(card) {
    const raw = parseInt(card.getAttribute('data-downloads') || '0', 10);
    return Number.isNaN(raw) ? 0 : raw;
  }

  function getRibbonText(card) {
    return normaliseText(card.querySelector('.pack-ribbon')?.textContent || '');
  }

  function getTagTexts(card) {
    return Array.from(card.querySelectorAll('.pack-tag')).map(tag => normaliseText(tag.textContent));
  }

  function getPopularCardSet() {
    const ranked = getAllCards()
      .slice()
      .sort((a, b) => getCardDownloads(b) - getCardDownloads(a));

    const cardsWithDownloads = ranked.filter(card => getCardDownloads(card) > 0);
    const source = cardsWithDownloads.length ? cardsWithDownloads : ranked;
    return new Set(source.slice(0, Math.min(12, source.length)));
  }

  function matchesCategory(card, popularCards) {
    const category = state.category;
    if (category === 'all') return true;

    const ribbonText = getRibbonText(card);
    const cardDate = parseCardDate(card);
    const recentCutoff = new Date();
    recentCutoff.setMonth(recentCutoff.getMonth() - 12);

    if (category === 'new') {
      return ribbonText.includes('new');
    }

    if (category === 'popular') {
      return popularCards.has(card);
    }

    if (category === 'updated') {
      return ribbonText.includes('updated') || cardDate >= recentCutoff;
    }

    return true;
  }

  function matchesCard(card, popularCards) {
    const query = state.search;
    const title = normaliseText(card.querySelector('.pack-title')?.textContent || '');
    const description = normaliseText(card.querySelector('.pack-description')?.textContent || '');
    const tags = getTagTexts(card);
    const theme = normaliseText(card.getAttribute('data-theme'));
    const scale = card.getAttribute('data-scale') || '256x256';
    const versions = (card.getAttribute('data-version') || '').split(/\s+/).filter(Boolean);

    const matchesSearch =
      !query ||
      title.includes(query) ||
      description.includes(query) ||
      tags.some(tag => tag.includes(query));

    const matchesVersion = state.version === 'all' || versions.includes(state.version);
    const matchesTheme = state.theme === 'all' || theme === state.theme;
    const matchesScale = state.scale === 'all' || scale === state.scale;
    const matchesSelectedCategory = matchesCategory(card, popularCards);

    return matchesSearch && matchesVersion && matchesTheme && matchesScale && matchesSelectedCategory;
  }

  function compareCards(a, b) {
    if (state.sort === 'newest') {
      return parseCardDate(b) - parseCardDate(a);
    }
    if (state.sort === 'oldest') {
      return parseCardDate(a) - parseCardDate(b);
    }
    if (state.sort === 'az') {
      return (a.querySelector('.pack-title')?.textContent || '').trim()
        .localeCompare((b.querySelector('.pack-title')?.textContent || '').trim());
    }
    if (state.sort === 'za') {
      return (b.querySelector('.pack-title')?.textContent || '').trim()
        .localeCompare((a.querySelector('.pack-title')?.textContent || '').trim());
    }
    return 0;
  }

  function smoothScrollToPosition(targetY, duration = 850) {
    const startY = window.scrollY;
    const distance = targetY - startY;
    const startTime = performance.now();

    function easeInOutCubic(t) {
      return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeInOutCubic(progress);
      window.scrollTo(0, startY + distance * eased);

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }

  function getFilteredAndSortedCards() {
    const popularCards = getPopularCardSet();
    return getAllCards()
      .filter(card => matchesCard(card, popularCards))
      .sort(compareCards);
  }

  function renderSortedOrder(sortedCards) {
    const cardSet = new Set(sortedCards);
    const hiddenCards = getAllCards().filter(card => !cardSet.has(card)).sort(compareCards);
    [...sortedCards, ...hiddenCards].forEach(card => packsContainer.appendChild(card));
  }

  function updatePaginationControls(totalVisible, page) {
    const totalPages = Math.max(1, Math.ceil(totalVisible / ITEMS_PER_PAGE));
    const pageNumbers = document.querySelectorAll('.page-number');

    if (prevPageBtn) prevPageBtn.disabled = page === 1;
    if (nextPageBtn) nextPageBtn.disabled = page >= totalPages;

    pageNumbers.forEach((btn, index) => {
      const pageNumber = index + 1;
      btn.setAttribute('data-page', String(pageNumber));
      btn.textContent = String(pageNumber);
      btn.classList.toggle('active', pageNumber === page);
      btn.style.display = pageNumber <= totalPages ? '' : 'none';
    });

    if (paginationJumpContainer) {
      paginationJumpContainer.style.display = totalPages > pageNumbers.length ? 'block' : 'none';
    }

    if (jumpPageInput) {
      jumpPageInput.max = String(totalPages);
      jumpPageInput.placeholder = `Go to page (1-${totalPages})`;
    }
  }

  function updateVisiblePackCount(totalVisible) {
    if (packCount) {
      packCount.textContent = totalVisible;
    }
  }

  function showPage(page, options = {}) {
    const { scroll = true } = options;
    const visibleCards = getFilteredAndSortedCards();

    renderSortedOrder(visibleCards);
    updateVisiblePackCount(visibleCards.length);

    const totalPages = Math.max(1, Math.ceil(visibleCards.length / ITEMS_PER_PAGE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    currentPage = safePage;

    const start = (safePage - 1) * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, visibleCards.length);
    const currentPageCards = visibleCards.slice(start, end);

    getAllCards().forEach(card => {
      card.style.display = 'none';
      card.style.animation = 'none';
      card.style.opacity = '0';
      card.style.transform = 'translateY(18px)';
    });

    currentPageCards.forEach((card, index) => {
      card.style.display = '';
      void card.offsetWidth;
      card.style.animation = `packPageFadeUp 720ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 90}ms both`;
    });

    updatePaginationControls(visibleCards.length, safePage);

    if (scroll && currentPageCards.length > 0) {
      const firstCard = currentPageCards[0];
      const firstCardTop = firstCard.getBoundingClientRect().top + window.scrollY;
      const eyeLineOffset = Math.max(72, Math.min(120, window.innerHeight * 0.12));
      const scrollTarget = Math.max(0, firstCardTop - eyeLineOffset);
      smoothScrollToPosition(scrollTarget, 850);
    }
  }

  function applyState(options = {}) {
    const { scroll = false, page = 1 } = options;
    showPage(page, { scroll });
  }

  function clearSearch() {
    if (!searchInput) return;
    searchInput.value = '';
    state.search = '';
    if (searchClear) {
      searchClear.classList.remove('visible');
    }
    applyState({ scroll: false, page: 1 });
  }

  if (searchInput) {
    searchInput.addEventListener('input', function() {
      state.search = normaliseText(this.value);
      if (searchClear) {
        searchClear.classList.toggle('visible', this.value.length > 0);
      }
      applyState({ scroll: false, page: 1 });
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', clearSearch);
  }

  if (versionFilter) {
    versionFilter.addEventListener('change', function() {
      state.version = this.value;
      applyState({ scroll: false, page: 1 });
    });
  }

  if (themeFilter) {
    themeFilter.addEventListener('change', function() {
      state.theme = normaliseText(this.value);
      applyState({ scroll: false, page: 1 });
    });
  }

  if (scaleFilter) {
    scaleFilter.addEventListener('change', function() {
      state.scale = this.value;
      applyState({ scroll: false, page: 1 });
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', function() {
      state.sort = this.value;
      applyState({ scroll: false, page: 1 });
    });
  }

  categoryTabs.forEach(tab => {
    tab.addEventListener('click', function() {
      categoryTabs.forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      state.category = this.getAttribute('data-category') || 'all';
      applyState({ scroll: false, page: 1 });
    });
  });

  viewButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const view = this.getAttribute('data-view');
      viewButtons.forEach(b => b.classList.remove('active'));
      this.classList.add('active');

      if (view === 'list') {
        packsContainer.classList.add('list-view');
      } else {
        packsContainer.classList.remove('list-view');
      }
    });
  });

  document.addEventListener('click', function(event) {
    const target = event.target.closest('.page-number');
    if (!target) return;
    const page = parseInt(target.getAttribute('data-page') || '1', 10);
    showPage(page, { scroll: true });
  });

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', function() {
      if (currentPage > 1) {
        showPage(currentPage - 1, { scroll: true });
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', function() {
      const totalVisible = getFilteredAndSortedCards().length;
      const totalPages = Math.max(1, Math.ceil(totalVisible / ITEMS_PER_PAGE));
      if (currentPage < totalPages) {
        showPage(currentPage + 1, { scroll: true });
      }
    });
  }

  document.addEventListener('keydown', function(event) {
    const totalVisible = getFilteredAndSortedCards().length;
    const totalPages = Math.max(1, Math.ceil(totalVisible / ITEMS_PER_PAGE));

    if (event.key === 'ArrowRight' && currentPage < totalPages) {
      showPage(currentPage + 1, { scroll: true });
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' && currentPage > 1) {
      showPage(currentPage - 1, { scroll: true });
      event.preventDefault();
    } else if (event.key === 'Home' && currentPage !== 1) {
      showPage(1, { scroll: true });
      event.preventDefault();
    } else if (event.key === 'End' && currentPage !== totalPages) {
      showPage(totalPages, { scroll: true });
      event.preventDefault();
    }
  });

  if (jumpPageInput) {
    jumpPageInput.addEventListener('keydown', function(event) {
      if (event.key !== 'Enter') return;

      const totalVisible = getFilteredAndSortedCards().length;
      const totalPages = Math.max(1, Math.ceil(totalVisible / ITEMS_PER_PAGE));
      const requestedPage = parseInt(this.value, 10);

      if (requestedPage >= 1 && requestedPage <= totalPages) {
        showPage(requestedPage, { scroll: true });
        this.value = '';
        this.blur();
      } else {
        this.style.borderColor = 'rgba(255, 0, 0, 0.5)';
        setTimeout(() => {
          this.style.borderColor = '';
        }, 1000);
      }
    });
  }

  // ---- featured carousel ----

  function setupRandomFeaturedPacks() {
    const allPacks = getAllCards();
    const featuredCarousel = document.getElementById('featured-carousel');
    const carouselIndicators = document.getElementById('carousel-indicators');

    if (!featuredCarousel || !carouselIndicators) return;

    featuredCarousel.innerHTML = '';
    carouselIndicators.innerHTML = '';

    const shuffledPacks = allPacks.slice().sort(() => 0.5 - Math.random());
    const selectedPacks = shuffledPacks.slice(0, 3);

    selectedPacks.forEach((pack, index) => {
      const packTitle = pack.querySelector('.pack-title')?.textContent || '';
      const packDescription = pack.querySelector('.pack-description')?.textContent || '';
      const packVersion = pack.querySelector('.pack-version')?.textContent || '';
      const packImage = pack.querySelector('.pack-image')?.src || '';
      const packLink = pack.querySelector('.overlay-btn')?.href || '#';

      const featuredPack = document.createElement('div');
      featuredPack.className = 'featured-pack';
      featuredPack.innerHTML = `
        <div class="featured-content">
          <div class="featured-text">
            <h3>${packTitle}</h3>
            <p>${packDescription}</p>
            <div class="featured-meta">
              <span class="featured-version">v${packVersion}</span>
            </div>
            <a href="${packLink}" class="featured-btn">View Pack</a>
          </div>
          <div class="featured-image">
            <img src="${packImage}" alt="${packTitle}">
          </div>
        </div>
      `;

      featuredCarousel.appendChild(featuredPack);

      const indicator = document.createElement('div');
      indicator.className = 'carousel-dot' + (index === 0 ? ' active' : '');
      indicator.setAttribute('data-index', index);
      carouselIndicators.appendChild(indicator);

      indicator.addEventListener('click', function() {
        currentSlide = parseInt(this.getAttribute('data-index') || '0', 10);
        window.updateCarousel();
        window.resetAutoplay();
      });
    });

    initCarousel();
  }

  let currentSlide = 0;
  let autoplayInterval;

  function initCarousel() {
    const carousel = document.getElementById('featured-carousel');
    const prevBtn = document.querySelector('.carousel-prev');
    const nextBtn = document.querySelector('.carousel-next');

    if (!carousel) return;

    function updateCarousel() {
      const featuredPacks = carousel.querySelectorAll('.featured-pack');
      if (!featuredPacks.length) return;

      carousel.style.transform = `translateX(-${currentSlide * 100}%)`;
      document.querySelectorAll('.carousel-dot').forEach((dot, index) => {
        dot.classList.toggle('active', index === currentSlide);
      });
    }

    function nextSlide() {
      const featuredPacks = carousel.querySelectorAll('.featured-pack');
      if (!featuredPacks.length) return;
      currentSlide = (currentSlide + 1) % featuredPacks.length;
      updateCarousel();
    }

    function prevSlide() {
      const featuredPacks = carousel.querySelectorAll('.featured-pack');
      if (!featuredPacks.length) return;
      currentSlide = (currentSlide - 1 + featuredPacks.length) % featuredPacks.length;
      updateCarousel();
    }

    function startAutoplay() {
      clearInterval(autoplayInterval);
      autoplayInterval = setInterval(nextSlide, 5000);
    }

    function resetAutoplay() {
      startAutoplay();
    }

    if (prevBtn) {
      prevBtn.onclick = function() {
        prevSlide();
        resetAutoplay();
      };
    }

    if (nextBtn) {
      nextBtn.onclick = function() {
        nextSlide();
        resetAutoplay();
      };
    }

    carousel.addEventListener('mouseenter', function() {
      clearInterval(autoplayInterval);
    });

    carousel.addEventListener('mouseleave', function() {
      startAutoplay();
    });

    window.updateCarousel = updateCarousel;
    window.resetAutoplay = resetAutoplay;

    updateCarousel();
    startAutoplay();
  }

  // ---- boot ----

  applyState({ scroll: false, page: 1 });
  setTimeout(setupRandomFeaturedPacks, 300);
});
