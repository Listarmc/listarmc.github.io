// Enhanced search functionality
document.addEventListener("DOMContentLoaded", () => {
    const searchBar = document.getElementById("search-bar")
    const packsGrid = document.getElementById("packs-grid")
    const packs = document.querySelectorAll(".pack")
  
    if (searchBar) {
      searchBar.addEventListener("input", () => {
        const searchTerm = searchBar.value.toLowerCase()
  
        packs.forEach((pack) => {
          const packName = pack.getAttribute("data-name").toLowerCase()
          const isVisible = packName.includes(searchTerm)
          pack.style.display = isVisible ? "block" : "none"
        })
      })
    }
  
    // Featured Packs Carousel
    const featuredPacks = [
      {
        name: "My Dress-Up Darling Custom GUI Pack",
        image: "thumbnails/221456a3163ec3f4b905f1926ea4a237ffaf6ef0.webp",
        versions: ["1.19.1", "1.20", "1.20.1", "1.20.2", "1.20.4", "1.20.6", "1.21", "1.21.1"],
        description:
          "Transform your Minecraft experience with this beautiful My Dress-Up Darling themed GUI pack featuring Marin Kitagawa and stunning custom textures.",
        href: "Packs/My-Dress-Up-Darling-Custom-GUI-Pack.html",
      },
      {
        name: "Demon Slayer Kimetsu no Yaiba Custom GUI Pack",
        image: "thumbnails//UoRcApc.png",
        versions: ["1.20.4"],
        description:
          "Experience the world of Demon Slayer with this meticulously crafted GUI pack featuring Tanjiro, Nezuko, and other beloved characters.",
        href: "Packs/Demon-Slayer-Kimetsu-no-Yaiba-Custom-GUI-Pack.html",
      },
      {
        name: "Jujutsu Kaisen Custom GUI Pack",
        image: "thumbnails/D2eqkVh.png",
        versions: ["1.21", "1.21.1", "1.20.2", "1.20.4"],
        description:
          "Enhance your Minecraft UI with this Jujutsu Kaisen themed pack featuring Yuji Itadori, Gojo Satoru, and other characters from the popular anime.",
        href: "Packs/Jujutsu-Kaisen-Custom-GUI-Pack.html",
      },
      {
        name: "Spy x Family GUI Pack",
        image: "thumbnails/QTXpJWs.png",
        versions: ["1.18.2", "1.19.3", "1.19.4", "1.20.1", "1.20.4"],
        description:
          "Bring the Forger family into your Minecraft world with this Spy x Family themed GUI pack featuring Anya, Loid, and Yor.",
        href: "Packs/Spy-X-Family-GUI-Pack.html",
      },
      {
        name: "Chainsaw Man Custom GUI Pack",
        image: "thumbnails/01HMDTBFYXVSHS6CM71A5TDF3T.webp",
        versions: ["1.20.4"],
        description:
          "Experience the chaotic world of Chainsaw Man with this custom GUI pack featuring Denji, Power, and other characters from the hit anime.",
        href: "Packs/Chainsaw-Man-Custom-GUI-Pack.html",
      },
    ]
  
    const carouselContainer = document.getElementById("carousel-container")
    const indicators = document.getElementById("carousel-indicators")
    const prevBtn = document.getElementById("prev-btn")
    const nextBtn = document.getElementById("next-btn")
  
    let currentSlide = 0
  
    // Create carousel slides
    if (carouselContainer && indicators) {
      featuredPacks.forEach((pack, index) => {
        // Create slide
        const slide = document.createElement("div")
        slide.className = "carousel-slide"
  
        // Create slide content
        slide.innerHTML = `
                  <a href="${pack.href}">
                      <img src="${pack.image}" alt="${pack.name}">
                      <div class="carousel-content">
                          <h3>${pack.name}</h3>
                          <div class="tags">
                              ${pack.versions.map((version) => `<span class="tag">${version}</span>`).join("")}
                          </div>
                          <p class="description">${pack.description}</p>
                      </div>
                  </a>
              `
  
        carouselContainer.appendChild(slide)
  
        // Create indicator
        const indicator = document.createElement("div")
        indicator.className = `indicator ${index === 0 ? "active" : ""}`
        indicator.addEventListener("click", () => goToSlide(index))
        indicators.appendChild(indicator)
      })
    }
  
    // Carousel navigation functions
    function updateCarousel() {
      if (carouselContainer) {
        carouselContainer.style.transform = `translateX(-${currentSlide * 100}%)`
  
        // Update indicators
        const allIndicators = document.querySelectorAll(".indicator")
        allIndicators.forEach((indicator, index) => {
          indicator.classList.toggle("active", index === currentSlide)
        })
      }
    }
  
    function goToSlide(slideIndex) {
      currentSlide = slideIndex
      updateCarousel()
    }
  
    function nextSlide() {
      currentSlide = (currentSlide + 1) % featuredPacks.length
      updateCarousel()
    }
  
    function prevSlide() {
      currentSlide = (currentSlide - 1 + featuredPacks.length) % featuredPacks.length
      updateCarousel()
    }
  
    // Add event listeners for carousel navigation
    if (prevBtn && nextBtn) {
      prevBtn.addEventListener("click", prevSlide)
      nextBtn.addEventListener("click", nextSlide)
    }
  
    // Auto-rotate carousel
    let carouselInterval = setInterval(nextSlide, 5000)
  
    // Pause auto-rotation when hovering over carousel
    const featuredCarousel = document.querySelector(".featured-carousel")
    if (featuredCarousel) {
      featuredCarousel.addEventListener("mouseenter", () => {
        clearInterval(carouselInterval)
      })
  
      featuredCarousel.addEventListener("mouseleave", () => {
        carouselInterval = setInterval(nextSlide, 5000)
      })
    }
  
    // Pagination functionality
    const packsPerPage = 12
    const allPacks = Array.from(document.querySelectorAll(".pack"))
    const totalPages = Math.ceil(allPacks.length / packsPerPage)
    let currentPage = 1
  
    const paginationContainer = document.getElementById("pagination")
  
    // Create pagination buttons
    if (paginationContainer) {
      // Previous button
      const prevPageBtn = document.createElement("button")
      prevPageBtn.className = "pagination-btn prev-page"
      prevPageBtn.textContent = "Previous"
      prevPageBtn.addEventListener("click", () => {
        if (currentPage > 1) {
          goToPage(currentPage - 1)
        }
      })
      paginationContainer.appendChild(prevPageBtn)
  
      // Page number buttons
      for (let i = 1; i <= totalPages; i++) {
        const pageBtn = document.createElement("button")
        pageBtn.className = `pagination-btn page-num ${i === 1 ? "active" : ""}`
        pageBtn.textContent = i
        pageBtn.addEventListener("click", () => goToPage(i))
        paginationContainer.appendChild(pageBtn)
      }
  
      // Next button
      const nextPageBtn = document.createElement("button")
      nextPageBtn.className = "pagination-btn next-page"
      nextPageBtn.textContent = "Next"
      nextPageBtn.addEventListener("click", () => {
        if (currentPage < totalPages) {
          goToPage(currentPage + 1)
        }
      })
      paginationContainer.appendChild(nextPageBtn)
    }
  
    // Function to display packs for the current page
    function displayPacksForPage(page) {
      const startIndex = (page - 1) * packsPerPage
      const endIndex = startIndex + packsPerPage
  
      allPacks.forEach((pack, index) => {
        pack.style.display = index >= startIndex && index < endIndex ? "block" : "none"
      })
    }
  
    // Function to navigate to a specific page
    function goToPage(page) {
      currentPage = page
  
      // Update active button
      const pageButtons = document.querySelectorAll(".pagination-btn.page-num")
      pageButtons.forEach((btn, index) => {
        btn.classList.toggle("active", index + 1 === page)
      })
  
      // Update prev/next button states
      const prevPageBtn = document.querySelector(".pagination-btn.prev-page")
      const nextPageBtn = document.querySelector(".pagination-btn.next-page")
  
      if (prevPageBtn) {
        prevPageBtn.classList.toggle("disabled", page === 1)
      }
  
      if (nextPageBtn) {
        nextPageBtn.classList.toggle("disabled", page === totalPages)
      }
  
      // Display packs for the current page
      displayPacksForPage(page)
  
      // Scroll to the top of the packs section
      const packsSection = document.getElementById("packs")
      if (packsSection) {
        packsSection.scrollIntoView({ behavior: "smooth" })
      }
    }
  
    // Initialize with the first page
    displayPacksForPage(1)
  })
  