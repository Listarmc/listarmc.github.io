document.addEventListener("DOMContentLoaded", () => {
  // Gallery initialization
  const galleryItems = document.querySelectorAll(".gallery-item")
  const modal = document.querySelector(".gallery-modal")
  const modalImage = document.querySelector(".modal-image")
  const modalClose = document.querySelector(".modal-close")
  const modalPrev = document.querySelector(".modal-prev")
  const modalNext = document.querySelector(".modal-next")
  const modalCounter = document.querySelector(".modal-counter")
  const modalThumbnails = document.querySelector(".modal-thumbnails")

  let currentIndex = 0
  const images = []

  // Collect all gallery images
  galleryItems.forEach((item, index) => {
    const img = item.querySelector("img")
    const imgSrc = img.getAttribute("src")
    const imgAlt = img.getAttribute("alt") || `Image ${index + 1}`

    images.push({
      src: imgSrc,
      alt: imgAlt,
    })

    // Create thumbnails for modal
    const thumbnail = document.createElement("img")
    thumbnail.classList.add("modal-thumbnail")
    thumbnail.src = imgSrc
    thumbnail.alt = `Thumbnail ${index + 1}`
    thumbnail.dataset.index = index
    modalThumbnails.appendChild(thumbnail)

    // Add click event to open modal
    item.addEventListener("click", () => {
      openModal(index)
    })
  })

  // Thumbnail click events
  document.querySelectorAll(".modal-thumbnail").forEach((thumb) => {
    thumb.addEventListener("click", () => {
      const index = Number.parseInt(thumb.dataset.index)
      updateModal(index)
    })
  })

  // Open modal function
  function openModal(index) {
    currentIndex = index
    updateModal(index)
    modal.classList.add("active")
    document.body.style.overflow = "hidden" // Prevent scrolling
  }

  // Close modal function
  function closeModal() {
    modal.classList.remove("active")
    document.body.style.overflow = "" // Restore scrolling
  }

  // Update modal content
  function updateModal(index) {
    if (index < 0) index = images.length - 1
    if (index >= images.length) index = 0

    currentIndex = index

    modalImage.src = images[index].src
    modalImage.alt = images[index].alt
    modalCounter.textContent = `${index + 1} / ${images.length}`

    // Update active thumbnail
    document.querySelectorAll(".modal-thumbnail").forEach((thumb) => {
      thumb.classList.remove("active")
      if (Number.parseInt(thumb.dataset.index) === index) {
        thumb.classList.add("active")
        thumb.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })
      }
    })

    // Add animation
    modalImage.classList.remove("fade-in")
    void modalImage.offsetWidth // Trigger reflow
    modalImage.classList.add("fade-in")
  }

  // Event listeners
  modalClose.addEventListener("click", closeModal)

  modalPrev.addEventListener("click", () => {
    updateModal(currentIndex - 1)
  })

  modalNext.addEventListener("click", () => {
    updateModal(currentIndex + 1)
  })

  // Close modal when clicking outside the image
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal()
    }
  })

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("active")) return

    if (e.key === "Escape") {
      closeModal()
    } else if (e.key === "ArrowLeft") {
      updateModal(currentIndex - 1)
    } else if (e.key === "ArrowRight") {
      updateModal(currentIndex + 1)
    }
  })

  // Touch swipe support
  let touchStartX = 0
  let touchEndX = 0

  modal.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX
  })

  modal.addEventListener("touchend", (e) => {
    touchEndX = e.changedTouches[0].screenX
    handleSwipe()
  })

  function handleSwipe() {
    const swipeThreshold = 50
    if (touchEndX < touchStartX - swipeThreshold) {
      // Swipe left
      updateModal(currentIndex + 1)
    } else if (touchEndX > touchStartX + swipeThreshold) {
      // Swipe right
      updateModal(currentIndex - 1)
    }
  }

  // Lazy loading for gallery images
  if ("IntersectionObserver" in window) {
    const lazyImages = document.querySelectorAll(".gallery-item img")

    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target
          const src = img.dataset.src

          if (src) {
            img.src = src
            img.removeAttribute("data-src")
          }

          observer.unobserve(img)
        }
      })
    })

    lazyImages.forEach((img) => {
      imageObserver.observe(img)
    })
  }
})
