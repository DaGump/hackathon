class A11yVideoPlayer {
  /** Registry of all player instances */
  static instances = {};

  /** All overridable actions with their default implementations */
  #actions = {};
  /** Overrides keyed by action name */
  #overrides = {};
  /** Event listeners keyed by event name */
  #listeners = {};
  
  #hideTimer;    // ✅ Declaration — required

  /**
   * @param {HTMLElement} container - The .a11y-player root element
   * @param {Object} [options] - Configuration options
   */
  constructor(container, options = {}) {
	this.container = container;
	this.id = container.id;
	this.video = container.querySelector('video');
	this.opts = { ...options };

	// Store instance
	A11yVideoPlayer.instances[this.id] = this;

	// Cache DOM references
	this.#cacheDom();

	// Register default actions
	this.#registerActions();

	// Build dynamic menus
	this.#buildSpeedMenu();
	this.#buildCaptionsMenu();

	// Bind all event listeners
	this.#bindEvents();

	// Initial UI state
	this.#initUI();

	// Auto-hide controls timer
	this.#hideTimer = null;
  }

  /* ============================
	 DOM CACHE
  ============================ */
  #cacheDom() {
	const c = this.container;
	this.dom = {
	  overlay:           c.querySelector('.a11y-player__overlay'),
	  controls:          c.querySelector('.a11y-player__controls'),
	  progressWrap:      c.querySelector('.a11y-player__progress-wrap'),
	  progress:          c.querySelector('.a11y-player__progress'),
	  progressBuffered:  c.querySelector('.a11y-player__progress-buffered'),
	  progressFilled:    c.querySelector('.a11y-player__progress-filled'),
	  progressThumb:     c.querySelector('.a11y-player__progress-thumb'),
	  progressTooltip:   c.querySelector('.a11y-player__progress-tooltip'),
	  btnPlay:           c.querySelector('.a11y-player__btn--play'),
	  btnMute:           c.querySelector('.a11y-player__btn--mute'),
	  volumeSlider:      c.querySelector('.a11y-player__volume-slider'),
	  timeCurrent:       c.querySelector('.a11y-player__time-current'),
	  timeDuration:      c.querySelector('.a11y-player__time-duration'),
	  btnCaptions:       c.querySelector('.a11y-player__btn--captions'),
	  captionsMenu:      c.querySelector('.a11y-player__captions-menu'),
	  btnSpeed:          c.querySelector('.a11y-player__btn--speed'),
	  speedMenu:         c.querySelector('.a11y-player__speed-menu'),
	  btnHelp:           c.querySelector('.a11y-player__btn--help'),
	  btnFullscreen:     c.querySelector('.a11y-player__btn--fullscreen'),
	  helpDialog:        c.querySelector('.a11y-player__help-dialog'),
	  helpClose:         c.querySelector('.a11y-player__help-close'),
	  announcer:         c.querySelector('.a11y-player__announcer'),
	};
  }

  /* ============================
	 ACTION REGISTRY
  ============================ */
  #registerActions() {
	const video = this.video;
	const self = this;

	this.#actions = {
	  playPause: {
		label: () => video.paused ? 'Play' : 'Pause',
		handler: () => {
		  if (video.paused) {
			this.#execAction('play');
		  } else {
			this.#execAction('pause');
		  }
		},
		key: 'k',
	  },

	  play: {
		label: () => 'Play',
		handler: () => {
		  const p = video.play();
		  if (p && p.catch) p.catch(() => {});
		},
	  },

	  pause: {
		label: () => 'Pause',
		handler: () => video.pause(),
	  },

	  mute: {
		label: () => video.muted ? 'Unmute' : 'Mute',
		handler: () => { video.muted = !video.muted; this.#updateVolumeUI(); },
		key: 'm',
	  },

	  seek: {
		label: () => 'Seek',
		handler: (time) => { video.currentTime = time; },
	  },

	  seekRelative: {
		label: () => 'Seek relative',
		handler: (delta) => { video.currentTime = Math.max(0, Math.min(video.currentTime + delta, video.duration || 0)); },
	  },

	  volumeUp: {
		label: () => 'Volume up',
		handler: () => { video.volume = Math.min(1, video.volume + 0.1); video.muted = false; this.#updateVolumeUI(); },
		key: 'ArrowUp',
	  },

	  volumeDown: {
		label: () => 'Volume down',
		handler: () => { video.volume = Math.max(0, video.volume - 0.1); this.#updateVolumeUI(); },
		key: 'ArrowDown',
	  },

	  setVolume: {
		label: () => 'Set volume',
		handler: (vol) => { video.volume = Math.max(0, Math.min(1, vol)); video.muted = false; this.#updateVolumeUI(); },
	  },

	  fullscreen: {
		label: () => self.#isFullscreen() ? 'Exit fullscreen' : 'Enter fullscreen',
		handler: () => self.#toggleFullscreen(),
		key: 'f',
	  },

	  captions: {
		label: () => 'Toggle captions',
		handler: () => this._toggleCaptions(),
		key: 'c',
	  },

	  setCaptions: {
		label: () => 'Set captions track',
		handler: (index) => this.#setCaptionTrack(index),
	  },

	  speed: {
		label: () => 'Cycle speed',
		handler: () => this.#cycleSpeed(),
		key: 's',
	  },

	  setSpeed: {
		label: () => 'Set speed',
		handler: (rate) => { video.playbackRate = rate; this.#updateSpeedUI(); },
	  },

	  help: {
		label: () => 'Keyboard shortcuts help',
		handler: () => this.#toggleHelpDialog(true),
		key: '?',
	  },
	};
  }

  /**
   * Execute an action, respecting any overrides.
   * @param {string} name - Action name
   * @param  {...any} args - Arguments to pass
   */
  #execAction(name, ...args) {
	const action = this.#actions[name];
	if (!action) return;

	if (this.#overrides[name]) {
	  // Call the override with the default handler and args
	  this.#overrides[name]((...overrideArgs) => action.handler(...overrideArgs), this.video, ...args);
	} else {
	  action.handler(...args);
	}

	this.#emit(name, ...args);
  }

  /* ============================
	 PUBLIC API: OVERRIDE
  ============================ */
  /**
   * Override a built-in action.
   * @param {string} name - The action name to override
   * @param {Function} fn - (defaultAction, video, ...args) => void
   *
   * Example:
   *   player.override('play', (defaultPlay, video) => {
   *     console.log('custom play!');
   *     defaultPlay();
   *   });
   */
  override(name, fn) {
	if (!this.#actions[name]) {
	  console.warn(`A11yVideoPlayer: Unknown action "${name}". Available: ${Object.keys(this.#actions).join(', ')}`);
	  return;
	}
	this.#overrides[name] = fn;
  }

  /**
   * Remove an override.
   * @param {string} name - Action name
   */
  removeOverride(name) {
	delete this.#overrides[name];
  }

  /* ============================
	 PUBLIC API: ADD NEW ACTION
  ============================ */
  /**
   * Add a completely new action and optionally inject a button into the controls.
   * @param {string} name - Unique action name
   * @param {Object} config
   * @param {string} config.label - Button label / tooltip
   * @param {string} [config.icon] - HTML string for icon
   * @param {Function} config.handler - (video) => void
   * @param {string} [config.key] - Keyboard shortcut key
   * @param {string} [config.position] - 'before:actionName' | 'after:actionName' | 'end'
   */
  addAction(name, config) {
	this.#actions[name] = {
	  label: () => config.label,
	  handler: config.handler,
	  key: config.key || null,
	};

	if (config.icon || config.label) {
	  this.#injectButton(name, config);
	}
  }

  /**
   * Remove an added action and its button.
   */
  removeAction(name) {
	delete this.#actions[name];
	delete this.#overrides[name];
	const btn = this.container.querySelector(`[data-action="${name}"]`);
	if (btn) btn.remove();
  }

  #injectButton(name, config) {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'a11y-player__btn';
	btn.dataset.action = name;
	btn.setAttribute('aria-label', config.label);

	let innerHTML = '';
	if (config.icon) innerHTML += config.icon;
	if (config.label && !config.icon) innerHTML += `<span style="font-size:13px;font-weight:600">${config.label}</span>`;
	if (config.label) innerHTML += `<span class="a11y-player__btn-tooltip">${config.label}${config.key ? ` (${config.key})` : ''}</span>`;
	btn.innerHTML = innerHTML;

	btn.addEventListener('click', () => this.#execAction(name));

	// Position
	const controls = this.dom.controls;
	if (config.position && config.position !== 'end') {
	  const [dir, refName] = config.position.split(':');
	  const ref = controls.querySelector(`[data-action="${refName}"]`);
	  if (ref) {
		if (dir === 'before') ref.parentNode.insertBefore(btn, ref);
		else ref.parentNode.insertBefore(btn, ref.nextSibling);
	  } else {
		controls.appendChild(btn);
	  }
	} else {
	  // Insert before the spacer or at end
	  const spacer = controls.querySelector('.a11y-player__spacer');
	  if (spacer) spacer.parentNode.insertBefore(btn, spacer);
	  else controls.appendChild(btn);
	}
  }

  /* ============================
	 PUBLIC API: EVENTS
  ============================ */
  /**
   * Subscribe to an event.
   * @param {string} event - play, pause, timeupdate, volumechange, seeked, ended, etc.
   * @param {Function} fn
   */
  on(event, fn) {
	if (!this.#listeners[event]) this.#listeners[event] = [];
	this.#listeners[event].push(fn);
  }

  off(event, fn) {
	if (!this.#listeners[event]) return;
	this.#listeners[event] = this.#listeners[event].filter(f => f !== fn);
  }

  #emit(event, ...args) {
	if (this.#listeners[event]) {
	  this.#listeners[event].forEach(fn => fn(...args));
	}
  }

  /* ============================
	 PUBLIC API: PROGRAMMATIC CONTROL
  ============================ */
  play()        { this.#execAction('play'); }
  pause()       { this.#execAction('pause'); }
  seek(time)    { this.#execAction('seek', time); }
  setVolume(v)  { this.#execAction('setVolume', v); }
  setSpeed(r)   { this.#execAction('setSpeed', r); }
  toggleCaptions(on) {
	if (on !== undefined) {
	  this.#setCaptionTrack(on ? 0 : -1);
	} else {
	  this._toggleCaptions();
	}
  }
  toggleFullscreen(on) {
	if (on === undefined) on = !this.#isFullscreen();
	if (on) this.#requestFullscreen();
	else this.#exitFullscreen();
  }

  /* ============================
	 EVENT BINDINGS
  ============================ */
  #bindEvents() {
	const video = this.video;
	const dom = this.dom;

	// ---- Video click to toggle play ----
	video.addEventListener('click', () => this.#execAction('playPause'));
	dom.overlay.addEventListener('click', () => this.#execAction('playPause'));

	// ---- Video time events ----
	video.addEventListener('timeupdate', () => this.#updateTimeUI());
	video.addEventListener('loadedmetadata', () => this.#onMetadataLoaded());
	video.addEventListener('durationchange', () => this.#onMetadataLoaded());
	video.addEventListener('progress', () => this.#updateBufferedUI());
	video.addEventListener('ended', () => this.#onEnded());
	video.addEventListener('play', () => this.#onPlayStateChange());
	video.addEventListener('pause', () => this.#onPlayStateChange());
	video.addEventListener('volumechange', () => {
	  this.#updateVolumeUI();
	  this.#emit('volumechange', video.volume);
	});
	video.addEventListener('seeked', () => this.#emit('seeked', video.currentTime));
	video.addEventListener('ratechange', () => this.#emit('ratechange', video.playbackRate));

	// ---- Control buttons via data-action ----
	dom.controls.addEventListener('click', (e) => {
	  const btn = e.target.closest('[data-action]');
	  if (btn) {
		e.stopPropagation();
		this.#execAction(btn.dataset.action);
	  }
	});

	// ---- Progress bar ----
	this.#bindProgressBar();

	// ---- Volume slider ----
	dom.volumeSlider.addEventListener('input', (e) => {
	  this.#execAction('setVolume', parseFloat(e.target.value));
	});
	const slider = document.querySelector('.a11y-player__volume-slider-wrap');

	dom.volumeSlider.addEventListener('focus', () => {
	  slider.classList.add('is-focused');
	});

	dom.volumeSlider.addEventListener('blur', () => {
	  slider.classList.remove('is-focused');
	});

	// ---- Fullscreen change ----
	document.addEventListener('fullscreenchange', () => this.#onFullscreenChange());

	// ---- Keyboard shortcuts ----
	this.container.addEventListener('keydown', (e) => this.#onKeyDown(e));

	// ---- Auto-hide controls ----
	this.container.addEventListener('mousemove', () => this.#showControls());
	this.container.addEventListener('mouseleave', () => this.#startHideTimer());
	this.#startHideTimer();
  }

  /* ============================
	 PROGRESS BAR
  ============================ */
  #bindProgressBar() {
	const wrap = this.dom.progressWrap;
	const video = this.video;
	let isSeeking = false;

	const seekToPosition = (e) => {
	  const rect = wrap.getBoundingClientRect();
	  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	  const time = pct * (video.duration || 0);
	  this.#execAction('seek', time);
	};

	const updateTooltip = (e) => {
	  const rect = wrap.getBoundingClientRect();
	  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	  const time = pct * (video.duration || 0);
	  this.dom.progressTooltip.textContent = this.#formatTime(time);
	  this.dom.progressTooltip.style.left = `${pct * 100}%`;
	  this.dom.progressThumb.style.left = `${pct * 100}%`;
	};

	wrap.addEventListener('mousedown', (e) => {
	  isSeeking = true;
	  seekToPosition(e);
	});

	document.addEventListener('mousemove', (e) => {
	  if (isSeeking) seekToPosition(e);
	  if (wrap.matches(':hover') || isSeeking) updateTooltip(e);
	});

	document.addEventListener('mouseup', () => {
	  isSeeking = false;
	});

	// Keyboard seeking on the progress bar
	wrap.addEventListener('keydown', (e) => {
	  if (e.key === 'ArrowRight') { e.preventDefault(); this.#execAction('seekRelative', 10); }
	  if (e.key === 'ArrowLeft') { e.preventDefault(); this.#execAction('seekRelative', -10); }
	  if (e.key === 'Home') { e.preventDefault(); this.#execAction('seek', 0); }
	  if (e.key === 'End') { e.preventDefault(); this.#execAction('seek', video.duration || 0); }
	});
  }

  /* ============================
	 KEYBOARD SHORTCUTS
  ============================ */
  #onKeyDown(e) {
	// Don't capture if inside a text input or if dialog is open
	if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;

	// Close help dialog on Escape
	if (e.key === 'Escape') {
	  if (this.dom.helpDialog.classList.contains('is-open')) {
		this.#toggleHelpDialog(false);
		e.preventDefault();
		return;
	  }
	}

	// Key mapping
	const keyMap = {};
	for (const [name, action] of Object.entries(this.#actions)) {
	  if (action.key) keyMap[action.key] = name;
	}

	// Space also toggles play
	if (e.key === ' ') keyMap[' '] = 'playPause';
	if (e.key === 'ArrowLeft') keyMap['ArrowLeft'] = 'seekRelative';
	if (e.key === 'ArrowRight') keyMap['ArrowRight'] = 'seekRelative';

	const actionName = keyMap[e.key];
	if (!actionName) return;

	e.preventDefault();
	e.stopPropagation();

	if (actionName === 'seekRelative') {
	  const delta = e.key === 'ArrowLeft' ? -10 : 10;
	  this.#execAction('seekRelative', delta);
	  this.#announce(`Seeked ${delta > 0 ? 'forward' : 'backward'} ${Math.abs(delta)} seconds`);
	} else {
	  this.#execAction(actionName);
	}
  }

  /* ============================
	 UI UPDATES
  ============================ */
  #initUI() {
	this.#updatePlayUI();
	this.#updateVolumeUI();
	this.#updateSpeedUI();
  }

  #onMetadataLoaded() {
	const dur = this.video.duration;
	if (isFinite(dur)) {
	  this.dom.timeDuration.textContent = this.#formatTime(dur);
	}
  }

  #updateTimeUI() {
	const t = this.video.currentTime;
	const d = this.video.duration || 0;
	this.dom.timeCurrent.textContent = this.#formatTime(t);
	this.dom.timeDuration.textContent = this.#formatTime(d);

	// Progress bar
	const pct = d > 0 ? (t / d) * 100 : 0;
	this.dom.progressFilled.style.width = `${pct}%`;
	this.dom.progressThumb.style.left = `${pct}%`;
	this.dom.progressWrap.setAttribute('aria-valuenow', Math.round(pct));
	this.dom.progressWrap.setAttribute('aria-valuetext', `${this.#formatTime(t)} of ${this.#formatTime(d)}`);

	this.#emit('timeupdate', t);
  }

  #updateBufferedUI() {
	const video = this.video;
	if (video.buffered.length > 0 && video.duration > 0) {
	  const end = video.buffered.end(video.buffered.length - 1);
	  this.dom.progressBuffered.style.width = `${(end / video.duration) * 100}%`;
	}
  }

  #updatePlayUI() {
	const paused = this.video.paused;
	const dom = this.dom;

	// Toggle play/pause icons
	dom.btnPlay.querySelector('.icon-play').style.display = paused ? '' : 'none';
	dom.btnPlay.querySelector('.icon-pause').style.display = paused ? 'none' : '';
	dom.btnPlay.setAttribute('aria-label', paused ? 'Play' : 'Pause');
	dom.btnPlay.querySelector('.a11y-player__btn-tooltip').textContent = `${paused ? 'Play' : 'Pause'} (k)`;

	// Overlay
	dom.overlay.classList.toggle('is-hidden', !paused);

	// Announce
	this.#announce(paused ? 'Paused' : 'Playing');
  }

  #onPlayStateChange() {
	this.#updatePlayUI();
	this.#emit(this.video.paused ? 'pause' : 'play');
  }

  #updateVolumeUI() {
	const video = this.video;
	const vol = video.volume;
	const muted = video.muted;

	this.dom.volumeSlider.value = muted ? 0 : vol;

	// Update slider background for filled portion
	const pct = muted ? 0 : vol * 100;
	this.dom.volumeSlider.style.background = `linear-gradient(to right, var(--volume-filled) 0%, var(--volume-filled) ${pct}%, var(--volume-track) ${pct}%, var(--volume-track) 100%)`;

	// Toggle volume icons
	const high = this.dom.btnMute.querySelector('.icon-volume-high');
	const low  = this.dom.btnMute.querySelector('.icon-volume-low');
	const mute = this.dom.btnMute.querySelector('.icon-volume-mute');

	high.style.display = (!muted && vol > 0.5) ? '' : 'none';
	low.style.display  = (!muted && vol > 0 && vol <= 0.5) ? '' : 'none';
	mute.style.display = (muted || vol === 0) ? '' : 'none';

	this.dom.btnMute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
	this.dom.btnMute.querySelector('.a11y-player__btn-tooltip').textContent = `${muted ? 'Unmute' : 'Mute'} (m)`;
  }

  #updateSpeedUI() {
	const rate = this.video.playbackRate;
	this.dom.btnSpeed.childNodes.forEach(n => {
	  if (n.nodeType === 3) n.textContent = '';
	});
	// Update the visible text node (the "1x" text)
	this.dom.btnSpeed.innerHTML = `<span class="a11y-player__btn-tooltip">Speed (s)</span>${rate}x`;
	this.dom.btnSpeed.setAttribute('aria-label', `Playback speed ${rate}x`);

	// Update active state in menu
	this.dom.speedMenu.querySelectorAll('.a11y-player__speed-option').forEach(opt => {
	  opt.classList.toggle('is-active', parseFloat(opt.dataset.speed) === rate);
	});
  }

  #onEnded() {
	this.#updatePlayUI();
	this.#announce('Video ended');
	this.#emit('ended');
  }

  /* ============================
	 SPEED MENU
  ============================ */
  #buildSpeedMenu() {
	const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
	const menu = this.dom.speedMenu;

	speeds.forEach(rate => {
	  const btn = document.createElement('button');
	  btn.type = 'button';
	  btn.className = 'a11y-player__speed-option';
	  btn.dataset.speed = rate;
	  btn.textContent = `${rate}x`;
	  btn.setAttribute('role', 'menuitemradio');
	  btn.setAttribute('aria-checked', rate === 1 ? 'true' : 'false');
	  if (rate === 1) btn.classList.add('is-active');

	  btn.addEventListener('click', () => {
		this.#execAction('setSpeed', rate);
		this.#closeSpeedMenu();
	  });

	  menu.appendChild(btn);
	});
  }

  #cycleSpeed() {
	const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
	const current = this.video.playbackRate;
	const idx = speeds.indexOf(current);
	const next = speeds[(idx + 1) % speeds.length];
	this.#execAction('setSpeed', next);
	this.#announce(`Speed ${next}x`);
  }

  #closeSpeedMenu() {
	this.dom.speedMenu.classList.remove('is-open');
	this.dom.btnSpeed.setAttribute('aria-expanded', 'false');
  }

  #toggleSpeedMenu() {
	const isOpen = this.dom.speedMenu.classList.toggle('is-open');
	this.dom.btnSpeed.setAttribute('aria-expanded', String(isOpen));

	if (isOpen) {
	  // Focus the current speed option
	  const active = this.dom.speedMenu.querySelector('.is-active');
	  if (active) active.focus();
	}
  }

  /* ============================
	 CAPTIONS MENU
  ============================ */
  #buildCaptionsMenu() {
	const menu = this.dom.captionsMenu;

	// Off option
	const offBtn = document.createElement('button');
	offBtn.type = 'button';
	offBtn.className = 'a11y-player__captions-option is-active';
	offBtn.dataset.track = '-1';
	offBtn.textContent = 'Off';
	offBtn.setAttribute('role', 'menuitemradio');
	offBtn.setAttribute('aria-checked', 'true');
	offBtn.addEventListener('click', () => {
	  this.#setCaptionTrack(-1);
	  this._closeCaptionsMenu();
	});
	menu.appendChild(offBtn);

	// Wait for tracks to load, then populate
	const buildTracks = () => {
	  const tracks = this.video.textTracks;
	  for (let i = 0; i < tracks.length; i++) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'a11y-player__captions-option';
		btn.dataset.track = i;
		btn.textContent = tracks[i].label || tracks[i].language || `Track ${i + 1}`;
		btn.setAttribute('role', 'menuitemradio');
		btn.setAttribute('aria-checked', 'false');
		btn.addEventListener('click', () => {
		  this.#setCaptionTrack(i);
		  this._closeCaptionsMenu();
		});
		menu.appendChild(btn);
	  }
	};

	if (this.video.readyState >= 1) {
	  buildTracks();
	} else {
	  this.video.addEventListener('loadedmetadata', buildTracks, { once: true });
	}
  }

  _toggleCaptions() {
	const tracks = this.video.textTracks;
	let anyShowing = false;
	for (let i = 0; i < tracks.length; i++) {
	  if (tracks[i].mode === 'showing') { anyShowing = true; break; }
	}
	this.#setCaptionTrack(anyShowing ? -1 : 0);
	this.#announce(anyShowing ? 'Captions off' : 'Captions on');
  }

  #setCaptionTrack(index) {
	const tracks = this.video.textTracks;
	for (let i = 0; i < tracks.length; i++) {
	  tracks[i].mode = (i === index) ? 'showing' : 'hidden';
	}

	// Update menu
	this.dom.captionsMenu.querySelectorAll('.a11y-player__captions-option').forEach(opt => {
	  const isActive = parseInt(opt.dataset.track) === index;
	  opt.classList.toggle('is-active', isActive);
	  opt.setAttribute('aria-checked', String(isActive));
	});

	// Update button state
	this.dom.btnCaptions.classList.toggle('is-active', index >= 0);
	this.#emit('captionschange', index);
  }

  _closeCaptionsMenu() {
	this.dom.captionsMenu.classList.remove('is-open');
	this.dom.btnCaptions.setAttribute('aria-expanded', 'false');
  }

  _toggleCaptionsMenu() {
	const isOpen = this.dom.captionsMenu.classList.toggle('is-open');
	this.dom.btnCaptions.setAttribute('aria-expanded', String(isOpen));
	this.#closeSpeedMenu();
	if (isOpen) {
	  const active = this.dom.captionsMenu.querySelector('.is-active');
	  if (active) active.focus();
	}
  }

  /* ============================
	 FULLSCREEN
  ============================ */
  #isFullscreen() {
	return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  #requestFullscreen() {
	const el = this.container;
	if (el.requestFullscreen) el.requestFullscreen();
	else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  }

  #exitFullscreen() {
	if (document.exitFullscreen) document.exitFullscreen();
	else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }

  #toggleFullscreen() {
	if (this.#isFullscreen()) this.#exitFullscreen();
	else this.#requestFullscreen();
  }

  #onFullscreenChange() {
	const isFS = this.#isFullscreen();
	this.dom.btnFullscreen.querySelector('.icon-enter-fs').style.display = isFS ? 'none' : '';
	this.dom.btnFullscreen.querySelector('.icon-exit-fs').style.display = isFS ? '' : 'none';
	this.dom.btnFullscreen.setAttribute('aria-label', isFS ? 'Exit fullscreen' : 'Enter fullscreen');
	this.dom.btnFullscreen.querySelector('.a11y-player__btn-tooltip').textContent =
	  `${isFS ? 'Exit' : 'Enter'} fullscreen (f)`;
	this.#announce(isFS ? 'Fullscreen' : 'Exit fullscreen');
	this.#emit('fullscreenchange', isFS);
  }

  /* ============================
	 HELP DIALOG
  ============================ */
  #toggleHelpDialog(show) {
	this.dom.helpDialog.classList.toggle('is-open', show);
	if (show) {
	  this.dom.helpClose.focus();
	  // Trap focus inside
	  this.#trapFocus(this.dom.helpDialog);
	}
  }

  #trapFocus(dialog) {
	const focusable = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
	const first = focusable[0];
	const last = focusable[focusable.length - 1];

	const handler = (e) => {
	  if (!dialog.classList.contains('is-open')) {
		dialog.removeEventListener('keydown', handler);
		return;
	  }
	  if (e.key === 'Tab') {
		if (e.shiftKey && document.activeElement === first) {
		  e.preventDefault();
		  last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
		  e.preventDefault();
		  first.focus();
		}
	  }
	  if (e.key === 'Escape') {
		this.#toggleHelpDialog(false);
		this.dom.btnHelp.focus();
	  }
	};
	dialog.addEventListener('keydown', handler);
  }

  /* ============================
	 AUTO-HIDE CONTROLS
  ============================ */
  #showControls() {
	this.container.classList.remove('hide-controls');
	this.#startHideTimer();
  }

  #startHideTimer() {
	clearTimeout(this.#hideTimer);
	if (!this.video.paused) {
	  this.#hideTimer = setTimeout(() => {
		if (!this.video.paused) {
		  this.container.classList.add('hide-controls');
		}
	  }, 3000);
	}
  }

  /* ============================
	 LIVE REGION ANNOUNCER
  ============================ */
  #announce(text) {
	this.dom.announcer.textContent = '';
	// Small delay to force screen readers to re-announce
	requestAnimationFrame(() => {
	  this.dom.announcer.textContent = text;
	});
  }

  /* ============================
	 UTILITIES
  ============================ */
  #formatTime(seconds) {
	if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
	const s = Math.floor(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (h > 0) {
	  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
	}
	return `${m}:${String(sec).padStart(2, '0')}`;
  }
}

// ============================
// INITIALIZE PLAYER
// ============================
document.addEventListener('DOMContentLoaded', () => {
  const player = new A11yVideoPlayer(document.getElementById('my-player'));

  // Wire up the captions & speed menu toggle buttons
  // (These are handled by data-action clicks for the main action,
  //  but we need to toggle the menus themselves)
  player.container.querySelector('.a11y-player__btn--captions').addEventListener('click', (e) => {
	e.stopPropagation();
	// The data-action="captions" already fires _toggleCaptions
	// We override to toggle the menu instead when it's a direct click
  });

  // Replace captions button action to open menu
  player.override('captions', (defaultAction, video) => {
	player.container.querySelector('.a11y-player__captions-menu').classList.contains('is-open')
	  ? player._closeCaptionsMenu?.()
	  : player._toggleCaptionsMenu?.();
	// fallback:
	if (!player._toggleCaptionsMenu) player._toggleCaptions();
  });

  // Actually, let's fix this properly by wiring directly:
  document.querySelector('.a11y-player__btn--captions').addEventListener('click', (e) => {
	// We stop the data-action handler and handle menu ourselves
  });
});

// Clean re-initialization to avoid the wiring issues above:
document.addEventListener('DOMContentLoaded', () => {
  // The player is already created above; let's properly wire menus

  const container = document.getElementById('my-player');
  const btnCaptions = container.querySelector('.a11y-player__btn--captions');
  const btnSpeed = container.querySelector('.a11y-player__btn--speed');
  const captionsMenu = container.querySelector('.a11y-player__captions-menu');
  const speedMenu = container.querySelector('.a11y-player__speed-menu');
  const btnHelp = container.querySelector('.a11y-player__btn--help');
  const helpDialog = container.querySelector('.a11y-player__help-dialog');
  const helpClose = container.querySelector('.a11y-player__help-close');

  // Speed menu toggle
  btnSpeed.addEventListener('click', (e) => {
	e.stopPropagation();
	const isOpen = speedMenu.classList.toggle('is-open');
	btnSpeed.setAttribute('aria-expanded', String(isOpen));
	captionsMenu.classList.remove('is-open');
	if (isOpen) {
	  const active = speedMenu.querySelector('.is-active');
	  if (active) active.focus();
	}
  });

  // Captions menu toggle
  btnCaptions.addEventListener('click', (e) => {
	e.stopPropagation();
	const isOpen = captionsMenu.classList.toggle('is-open');
	btnCaptions.setAttribute('aria-expanded', String(isOpen));
	speedMenu.classList.remove('is-open');
	if (isOpen) {
	  const active = captionsMenu.querySelector('.is-active');
	  if (active) active.focus();
	}
  });

  // Help dialog
  btnHelp.addEventListener('click', (e) => {
	e.stopPropagation();
	helpDialog.classList.add('is-open');
	helpClose.focus();
  });
  helpClose.addEventListener('click', () => {
	helpDialog.classList.remove('is-open');
	btnHelp.focus();
  });

  // Close menus on outside click
  document.addEventListener('click', (e) => {
	if (!btnSpeed.contains(e.target) && !speedMenu.contains(e.target)) {
	  speedMenu.classList.remove('is-open');
	}
	if (!btnCaptions.contains(e.target) && !captionsMenu.contains(e.target)) {
	  captionsMenu.classList.remove('is-open');
	}
  });

  // Keyboard trap in help dialog handled inside the class
});