// Minecraft UI JavaScript

// Play sound effects
function playMinecraftSound(sound) {
  const sounds = {
    click: "https://www.myinstants.com/media/sounds/minecraft-click.mp3",
    pop: "https://www.myinstants.com/media/sounds/minecraft-pop.mp3",
    levelup: "https://www.myinstants.com/media/sounds/minecraft-levelup.mp3",
    break: "https://www.myinstants.com/media/sounds/minecraft_break.mp3",
    place: "https://www.myinstants.com/media/sounds/minecraft-wood-place.mp3",
    achievement: "https://www.myinstants.com/media/sounds/achievement.mp3",
    hurt: "https://www.myinstants.com/media/sounds/minecraft-hit.mp3",
    explode: "https://www.myinstants.com/media/sounds/explosion.mp3",
    portal: "https://www.myinstants.com/media/sounds/minecraft-portal.mp3",
    door: "https://www.myinstants.com/media/sounds/door.mp3",
    eat: "https://www.myinstants.com/media/sounds/minecraft-eat.mp3",
    drink: "https://www.myinstants.com/media/sounds/minecraft-drink.mp3",
    anvil: "https://www.myinstants.com/media/sounds/minecraft-anvil.mp3",
    bow: "https://www.myinstants.com/media/sounds/minecraft-bow.mp3",
    tnt: "https://www.myinstants.com/media/sounds/minecraft-tnt.mp3",
    xp: "https://www.myinstants.com/media/sounds/minecraft-xp.mp3",
  }

  if (sounds[sound]) {
    const audio = new Audio(sounds[sound])
    audio.volume = 0.3
    audio.play().catch((e) => console.log("Audio play failed:", e))
  }
}

// Create XP orbs
function createXPOrbs(element, count = 5) {
  const rect = element.getBoundingClientRect()

  for (let i = 0; i < count; i++) {
    const orb = document.createElement("div")
    orb.className = "xp-orb"

    // Random position within the element
    const x = rect.left + Math.random() * rect.width
    const y = rect.top + Math.random() * rect.height

    orb.style.left = `${x}px`
    orb.style.top = `${y}px`

    // Random movement
    const angle = Math.random() * Math.PI * 2
    const distance = 50 + Math.random() * 100
    const duration = 1 + Math.random() * 1.5

    const targetX = x + Math.cos(angle) * distance
    const targetY = y - distance // Always float upward

    orb.style.transition = `all ${duration}s ease-out`

    document.body.appendChild(orb)

    // Start animation after a small delay
    setTimeout(() => {
      orb.style.left = `${targetX}px`
      orb.style.top = `${targetY}px`
      orb.style.opacity = "0"
    }, 10)

    // Remove the orb after animation
    setTimeout(() => {
      orb.remove()
    }, duration * 1000)
  }

  playMinecraftSound("xp")
}

// Show achievement
function showAchievement(title, description) {
  // Create achievement element if it doesn't exist
  let achievement = document.getElementById("minecraft-achievement")

  if (!achievement) {
    achievement = document.createElement("div")
    achievement.id = "minecraft-achievement"
    achievement.className = "minecraft-achievement"

    const icon = document.createElement("div")
    icon.className = "achievement-icon"
    icon.innerHTML = '<i class="fa fa-trophy"></i>'

    const text = document.createElement("div")
    text.className = "achievement-text"

    const titleEl = document.createElement("div")
    titleEl.className = "achievement-title"

    const descEl = document.createElement("div")
    descEl.className = "achievement-desc"

    text.appendChild(titleEl)
    text.appendChild(descEl)

    achievement.appendChild(icon)
    achievement.appendChild(text)

    document.body.appendChild(achievement)
  }

  // Update achievement content
  achievement.querySelector(".achievement-title").textContent = title
  achievement.querySelector(".achievement-desc").textContent = description

  // Show achievement
  achievement.classList.add("show")
  playMinecraftSound("achievement")

  // Hide achievement after 5 seconds
  setTimeout(() => {
    achievement.classList.remove("show")
  }, 5000)
}

// Create breaking animation
function createBreakingAnimation(element) {
  // Add breaking overlay if it doesn't exist
  let overlay = element.querySelector(".breaking-overlay")

  if (!overlay) {
    overlay = document.createElement("div")
    overlay.className = "breaking-overlay"
    element.appendChild(overlay)
  }

  // Add breaking class to start animation
  element.classList.add("breaking")
  playMinecraftSound("break")

  // Remove breaking class after animation
  setTimeout(() => {
    element.classList.remove("breaking")
  }, 500)
}

// Create particles
function createParticles(element, type = "default", count = 10) {
  const rect = element.getBoundingClientRect()

  for (let i = 0; i < count; i++) {
    const particle = document.createElement("div")
    particle.className = `minecraft-particle ${type}`

    // Random position within the element
    const x = rect.left + Math.random() * rect.width
    const y = rect.top + Math.random() * rect.height

    particle.style.left = `${x}px`
    particle.style.top = `${y}px`

    // Random movement
    const angle = Math.random() * Math.PI * 2
    const distance = 20 + Math.random() * 40
    const duration = 0.5 + Math.random() * 0.5

    const targetX = x + Math.cos(angle) * distance
    const targetY = y + Math.sin(angle) * distance

    particle.style.setProperty("--x", `${Math.cos(angle) * distance}px`)
    particle.style.setProperty("--y", `${Math.sin(angle) * distance}px`)
    particle.style.animation = `particle-float ${duration}s forwards`

    document.body.appendChild(particle)

    // Remove the particle after animation
    setTimeout(() => {
      particle.remove()
    }, duration * 1000)
  }
}

// Show loading screen
function showMinecraftLoading(title = "Loading...", tips = []) {
  // Create loading screen if it doesn't exist
  let loadingScreen = document.getElementById("minecraft-loading-screen")

  if (!loadingScreen) {
    loadingScreen = document.createElement("div")
    loadingScreen.id = "minecraft-loading-screen"
    loadingScreen.className = "minecraft-loading-screen"

    const titleEl = document.createElement("div")
    titleEl.className = "minecraft-loading-screen-title"

    const progress = document.createElement("div")
    progress.className = "minecraft-loading-screen-progress"

    const progressBar = document.createElement("div")
    progressBar.className = "minecraft-loading-screen-progress-bar"

    const tip = document.createElement("div")
    tip.className = "minecraft-loading-screen-tip"

    progress.appendChild(progressBar)

    loadingScreen.appendChild(titleEl)
    loadingScreen.appendChild(progress)
    loadingScreen.appendChild(tip)

    document.body.appendChild(loadingScreen)
  }

  // Update loading screen content
  loadingScreen.querySelector(".minecraft-loading-screen-title").textContent = title

  // Show random tip if tips are provided
  if (tips.length > 0) {
    const randomTip = tips[Math.floor(Math.random() * tips.length)]
    loadingScreen.querySelector(".minecraft-loading-screen-tip").textContent = `Tip: ${randomTip}`
  } else {
    loadingScreen.querySelector(".minecraft-loading-screen-tip").textContent = ""
  }

  // Reset progress bar
  const progressBar = loadingScreen.querySelector(".minecraft-loading-screen-progress-bar")
  progressBar.style.width = "0%"

  // Show loading screen
  loadingScreen.style.display = "flex"

  // Animate progress bar
  let progress = 0
  const interval = setInterval(() => {
    progress += Math.random() * 5
    if (progress >= 100) {
      progress = 100
      clearInterval(interval)

      // Hide loading screen after a short delay
      setTimeout(() => {
        loadingScreen.style.display = "none"
      }, 500)
    }
    progressBar.style.width = `${progress}%`
  }, 100)

  return {
    setProgress: (value) => {
      clearInterval(interval)
      progressBar.style.width = `${value}%`
      if (value >= 100) {
        setTimeout(() => {
          loadingScreen.style.display = "none"
        }, 500)
      }
    },
    hide: () => {
      clearInterval(interval)
      loadingScreen.style.display = "none"
    },
  }
}

// Show death screen
function showMinecraftDeathScreen(message = "You died!", score = 0) {
  // Create death screen if it doesn't exist
  let deathScreen = document.getElementById("minecraft-death-screen")

  if (!deathScreen) {
    deathScreen = document.createElement("div")
    deathScreen.id = "minecraft-death-screen"
    deathScreen.className = "minecraft-death-screen"

    const title = document.createElement("div")
    title.className = "minecraft-death-screen-title"

    const scoreEl = document.createElement("div")
    scoreEl.className = "minecraft-death-screen-score"

    const buttons = document.createElement("div")
    buttons.className = "minecraft-death-screen-buttons"

    const respawnBtn = document.createElement("button")
    respawnBtn.className = "minecraft-btn"
    respawnBtn.textContent = "Respawn"
    respawnBtn.onclick = () => {
      deathScreen.style.display = "none"
      playMinecraftSound("click")
    }

    const mainMenuBtn = document.createElement("button")
    mainMenuBtn.className = "minecraft-btn"
    mainMenuBtn.textContent = "Main Menu"
    mainMenuBtn.onclick = () => {
      window.location.href = "../index.html"
      playMinecraftSound("click")
    }

    buttons.appendChild(respawnBtn)
    buttons.appendChild(mainMenuBtn)

    deathScreen.appendChild(title)
    deathScreen.appendChild(scoreEl)
    deathScreen.appendChild(buttons)

    document.body.appendChild(deathScreen)
  }

  // Update death screen content
  deathScreen.querySelector(".minecraft-death-screen-title").textContent = message
  deathScreen.querySelector(".minecraft-death-screen-score").textContent = `Score: ${score}`

  // Show death screen
  deathScreen.style.display = "flex"
  playMinecraftSound("hurt")
}

// Initialize Minecraft UI
function initMinecraftUI() {
  // Add Minecraft font stylesheet if not already added
  if (!document.getElementById("minecraft-font-stylesheet")) {
    const link = document.createElement("link")
    link.id = "minecraft-font-stylesheet"
    link.rel = "stylesheet"
    link.href = "https://cdn.jsdelivr.net/gh/South-Paw/typeface-minecraft@master/index.css"
    document.head.appendChild(link)
  }

  // Add click sound to all minecraft buttons
  document.querySelectorAll(".minecraft-btn").forEach((button) => {
    button.addEventListener("click", () => {
      playMinecraftSound("click")
    })
  })

  // Initialize hotbar if it exists
  const hotbar = document.querySelector(".minecraft-hotbar")
  if (hotbar) {
    const slots = hotbar.querySelectorAll(".hotbar-slot")
    slots.forEach((slot, index) => {
      slot.addEventListener("click", () => {
        // Remove selected class from all slots
        slots.forEach((s) => s.classList.remove("selected"))
        // Add selected class to clicked slot
        slot.classList.add("selected")
        // Play sound
        playMinecraftSound("pop")
      })
    })

    // Select first slot by default
    if (slots.length > 0) {
      slots[0].classList.add("selected")
    }
  }

  // Initialize download buttons with XP orbs and achievement
  document.querySelectorAll(".download-btn").forEach((button) => {
    button.addEventListener("click", (e) => {
      // Create XP orbs
      createXPOrbs(button, 10)

      // Show achievement
      const platform = button.classList.contains("curseforge") ? "CurseForge" : "Modrinth"
      showAchievement("Download Started!", `Your download from ${platform} has begun.`)

      // Play different sounds based on platform
      if (button.classList.contains("curseforge")) {
        playMinecraftSound("click")
      } else {
        playMinecraftSound("levelup")
      }
    })
  })

  // Initialize breaking animation for thumbnails
  document.querySelectorAll(".thumbnail-item").forEach((item) => {
    item.addEventListener("click", () => {
      createBreakingAnimation(item)
    })
  })

  // Initialize particles for feature items
  document.querySelectorAll(".highlight-item").forEach((item) => {
    item.addEventListener("mouseenter", () => {
      createParticles(item, "default", 5)
    })
  })

  // Initialize tooltips
  document.querySelectorAll("[data-minecraft-tooltip]").forEach((element) => {
    const tooltip = document.createElement("div")
    tooltip.className = "minecraft-tooltip"
    tooltip.textContent = element.getAttribute("data-minecraft-tooltip")
    element.appendChild(tooltip)
    element.classList.add("tooltip-trigger")
  })

  // Initialize tabs
  document.querySelectorAll(".minecraft-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      // Get tab container
      const tabContainer = tab.parentElement
      // Get content container
      const contentContainer = tabContainer.nextElementSibling
      // Get tab index
      const tabIndex = Array.from(tabContainer.children).indexOf(tab)
      // Get content
      const content = contentContainer.children[tabIndex]

      // Remove active class from all tabs and content
      tabContainer.querySelectorAll(".minecraft-tab").forEach((t) => t.classList.remove("active"))
      contentContainer.querySelectorAll(".minecraft-tab-content").forEach((c) => c.classList.remove("active"))

      // Add active class to clicked tab and corresponding content
      tab.classList.add("active")
      content.classList.add("active")

      // Play sound
      playMinecraftSound("click")
    })
  })

  // Initialize accordions
  document.querySelectorAll(".minecraft-accordion-header").forEach((header) => {
    header.addEventListener("click", () => {
      header.classList.toggle("active")
      playMinecraftSound("click")
    })
  })

  // Initialize modals
  document.querySelectorAll("[data-minecraft-modal]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      const modalId = trigger.getAttribute("data-minecraft-modal")
      const modal = document.getElementById(modalId)

      if (modal) {
        modal.classList.add("show")
        playMinecraftSound("door")
      }
    })
  })

  document.querySelectorAll(".minecraft-modal-close").forEach((close) => {
    close.addEventListener("click", () => {
      const modal = close.closest(".minecraft-modal")
      modal.classList.remove("show")
      playMinecraftSound("door")
    })
  })

  // Close modal when clicking outside
  document.querySelectorAll(".minecraft-modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.classList.remove("show")
        playMinecraftSound("door")
      }
    })
  })
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", initMinecraftUI)

// Simulate download progress
function simulateDownload(button, platform) {
  // Create progress bar if it doesn't exist
  let progressContainer = document.getElementById(`${platform}-progress`)

  if (!progressContainer) {
    progressContainer = document.createElement("div")
    progressContainer.id = `${platform}-progress`
    progressContainer.className = "minecraft-progress-bar"

    const fill = document.createElement("div")
    fill.className = "fill"

    progressContainer.appendChild(fill)

    // Insert after button
    button.parentNode.insertBefore(progressContainer, button.nextSibling)
  }

  const fill = progressContainer.querySelector(".fill")
  fill.style.width = "0%"

  // Show progress bar
  progressContainer.style.display = "block"

  // Simulate progress
  let progress = 0
  const interval = setInterval(() => {
    progress += Math.random() * 5
    if (progress >= 100) {
      progress = 100
      clearInterval(interval)

      // Show completion achievement
      showAchievement("Download Complete!", `Your ${platform} download has finished.`)

      // Hide progress bar after a short delay
      setTimeout(() => {
        progressContainer.style.display = "none"
      }, 2000)
    }
    fill.style.width = `${progress}%`
  }, 100)
}

// Add floating animation to pack covers
function addFloatingAnimation() {
  document.querySelectorAll(".pack-cover").forEach((cover) => {
    cover.classList.add("minecraft-float")
  })
}

// Add Minecraft style to buttons
function minecraftifyButtons() {
  document.querySelectorAll(".view-all-btn, .request-btn").forEach((button) => {
    button.classList.add("minecraft-btn")
  })

  document.querySelectorAll(".download-btn").forEach((button) => {
    if (button.classList.contains("curseforge")) {
      button.setAttribute(
        "data-minecraft-tooltip",
        "Download from CurseForge. The most popular Minecraft mod platform.",
      )
    } else if (button.classList.contains("modrinth")) {
      button.setAttribute("data-minecraft-tooltip", "Download from Modrinth. An open source Minecraft mod platform.")
    }
  })
}

// Add Minecraft style to badges
function minecraftifyBadges() {
  document.querySelectorAll(".pack-badge").forEach((badge) => {
    if (badge.classList.contains("version")) {
      badge.classList.add("minecraft-badge", "success")
    } else if (badge.classList.contains("theme")) {
      badge.classList.add("minecraft-badge", "info")
    }
  })

  document.querySelectorAll(".compatibility-badge").forEach((badge) => {
    badge.classList.add("minecraft-badge")
  })
}

// Add Minecraft style to section titles
function minecraftifySectionTitles() {
  document.querySelectorAll(".section-title, .pack-subtitle, .resources-subtitle").forEach((title) => {
    title.style.fontFamily = "'Minecraft', sans-serif"
    title.style.textShadow = "2px 2px #3f3f3f"
  })
}

// Add Minecraft style to thumbnails
function minecraftifyThumbnails() {
  document.querySelectorAll(".thumbnail-item").forEach((item) => {
    item.classList.add("pixel-border")
  })
}

// Initialize all Minecraft UI enhancements
function initAllMinecraftEnhancements() {
  initMinecraftUI()
  addFloatingAnimation()
  minecraftifyButtons()
  minecraftifyBadges()
  minecraftifySectionTitles()
  minecraftifyThumbnails()

  // Add download simulation to download buttons
  document.querySelectorAll(".download-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const platform = button.classList.contains("curseforge") ? "curseforge" : "modrinth"
      simulateDownload(button, platform)
    })
  })

  // Add hotbar functionality
  const hotbarContainer = document.createElement("div")
  hotbarContainer.className = "minecraft-hotbar"
  hotbarContainer.innerHTML = `
        <div class="hotbar-slot" data-action="download-curseforge">
            <img src="curseforge-svgrepo-com.png" alt="CurseForge">
        </div>
        <div class="hotbar-slot" data-action="download-modrinth">
            <img src="modrinth.png" alt="Modrinth">
        </div>
        <div class="hotbar-slot" data-action="view-screenshots">
            <img src="https://static.wikia.nocookie.net/minecraft_gamepedia/images/f/f3/Book_JE2_BE2.png" alt="Screenshots">
        </div>
        <div class="hotbar-slot" data-action="join-discord">
            <img src="https://static.wikia.nocookie.net/minecraft_gamepedia/images/c/c0/Diamond_JE3_BE3.png" alt="Discord">
        </div>
        <div class="hotbar-slot" data-action="home">
            <img src="https://static.wikia.nocookie.net/minecraft_gamepedia/images/9/9d/Compass_JE3_BE3.gif" alt="Home">
        </div>
    `

  // Insert hotbar before the footer
  const footer = document.querySelector("footer")
  if (footer) {
    footer.parentNode.insertBefore(hotbarContainer, footer)

    // Add hotbar functionality
    hotbarContainer.querySelectorAll(".hotbar-slot").forEach((slot) => {
      slot.addEventListener("click", () => {
        const action = slot.getAttribute("data-action")

        // Remove selected class from all slots
        hotbarContainer.querySelectorAll(".hotbar-slot").forEach((s) => s.classList.remove("selected"))
        // Add selected class to clicked slot
        slot.classList.add("selected")

        // Perform action
        switch (action) {
          case "download-curseforge":
            document.querySelector(".download-btn.curseforge").click()
            break
          case "download-modrinth":
            document.querySelector(".download-btn.modrinth").click()
            break
          case "view-screenshots":
            document.querySelector(".view-all-btn").click()
            break
          case "join-discord":
            window.open("https://discord.gg/RvScgzj3Ph", "_blank")
            playMinecraftSound("portal")
            break
          case "home":
            playMinecraftSound("click")
            window.location.href = "../index.html"
            break
        }
      })
    })

    // Select first slot by default
    hotbarContainer.querySelector(".hotbar-slot").classList.add("selected")
  }

  // Add download counter
  document.querySelectorAll(".download-btn").forEach((button) => {
    const counter = document.createElement("div")
    counter.className = "minecraft-badge"
    counter.style.position = "absolute"
    counter.style.top = "-10px"
    counter.style.right = "-10px"
    counter.style.fontSize = "12px"

    // Random download count between 1000 and 50000
    const downloads = Math.floor(1000 + Math.random() * 49000)
    counter.textContent = `${downloads.toLocaleString()} downloads`

    button.style.position = "relative"
    button.appendChild(counter)
  })
}

// Call the initialization function when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  initAllMinecraftEnhancements()

  // Show welcome achievement
  setTimeout(() => {
    showAchievement("Welcome!", "You found an anime-inspired GUI pack!")
  }, 2000)
})

// Add keyboard shortcuts for hotbar
document.addEventListener("keydown", (e) => {
  // Number keys 1-9 select hotbar slots
  if (e.key >= "1" && e.key <= "9") {
    const index = Number.parseInt(e.key) - 1
    const slots = document.querySelectorAll(".minecraft-hotbar .hotbar-slot")

    if (slots[index]) {
      slots[index].click()
    }
  }

  // E key opens inventory (modal)
  if (e.key === "e" || e.key === "E") {
    const inventoryButton = document.querySelector('[data-minecraft-modal="minecraft-inventory"]')
    if (inventoryButton) {
      inventoryButton.click()
    }
  }
})

// Add day/night cycle effect
function addDayNightCycle() {
  const overlay = document.createElement("div")
  overlay.style.position = "fixed"
  overlay.style.top = "0"
  overlay.style.left = "0"
  overlay.style.width = "100%"
  overlay.style.height = "100%"
  overlay.style.pointerEvents = "none"
  overlay.style.zIndex = "9998"
  overlay.style.transition = "background-color 30s linear"
  document.body.appendChild(overlay)

  let isDay = true

  setInterval(() => {
    if (isDay) {
      overlay.style.backgroundColor = "rgba(0, 0, 30, 0.3)"
    } else {
      overlay.style.backgroundColor = "rgba(0, 0, 0, 0)"
    }
    isDay = !isDay
  }, 300000) // 5 minutes cycle
}

// Initialize day/night cycle
// Uncomment to enable: addDayNightCycle();
