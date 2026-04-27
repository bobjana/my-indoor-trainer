import trainer from './api.js';
import { FTMSController } from './ftms.js';
import { WorkoutManager } from './workout-manager.js';
import { StravaIntegration } from './strava.js';
import { HRZones, PowerZones } from './hr-zones.js';
import './style.css';


document.addEventListener('DOMContentLoaded', () => {
    const api = trainer;
    const $ = (selector) => document.querySelector(selector);

    const screens = {
        connect: $('#connect-screen'),
        selection: $('#workout-selection-screen'),
        workout: $('#workout-screen'),
        summary: $('#summary-screen'),
    };
    const helpModal = $('#help-modal');

    function showScreen(name) {
        Object.values(screens).forEach(s => {
            if (s) s.classList.remove('active');
        });
        if (screens[name]) {
            screens[name].classList.add('active');
        } else {
            console.warn(`Screen "${name}" not found.`);
        }
    }

    // Modal Logic
    $('#help-btn').addEventListener('click', () => {
        helpModal.style.display = 'flex';
    });

    $('#close-modal-btn').addEventListener('click', () => {
        helpModal.style.display = 'none';
    });

    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) {
            helpModal.style.display = 'none';
        }
    });

    const exitModal = $('#exit-modal');
    exitModal.addEventListener('click', (e) => {
        if (e.target === exitModal) {
            exitModal.style.display = 'none';
        }
    });

    function formatTime(seconds) {
        const min = Math.floor(seconds / 60).toString();
        const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${min}:${sec}`;
    }

    function getErrorMessage(error) {
        if (!error) return "An unknown connection error occurred.";
        switch (error.name) {
            case 'NotFoundError':
                return "No compatible trainer was found. Make sure it's on and in range.";
            case 'NotAllowedError':
                return "Bluetooth permission was denied. Please allow access in your browser settings.";
            case 'SecurityError':
                return "Connection failed due to a security issue. Ensure you are on a secure (HTTPS) connection.";
            default:
                return `Connection failed: ${error.message}`;
        }
    }

    // Connect Screen Logic
    $('#connect-trainer-btn').addEventListener('click', async () => {
        api.setStubMode(false); // Ensure real mode
        $('#connection-error-text').textContent = '';
        $('#trainer-status').textContent = 'Connecting...';
        const success = await api.connectTrainer();
        if (success) {
            $('#trainer-status').textContent = `Connected: ${api.ftms.device.name}`;
            $('#trainer-name-display').textContent = api.ftms.device.name;
            $('#connect-hr-btn').style.display = 'block';
            showScreen('selection');
            renderWorkoutList();
        } else {
            $('#trainer-status').textContent = 'Connection Failed';
        }
    });

    $('#use-stub-btn').addEventListener('click', async () => {
        api.setStubMode(true);
        $('#connection-error-text').textContent = '';
        $('#trainer-status').textContent = 'Connecting to Stub...';
        const success = await api.connectTrainer();
        if (success) {
            $('#trainer-status').textContent = `Connected: ${api.ftms.device.name}`;
            $('#trainer-name-display').textContent = api.ftms.device.name;
            showScreen('selection');
            renderWorkoutList();
        } else {
            $('#trainer-status').textContent = 'Stub Connection Failed';
        }
    });

    $('#disconnect-btn').addEventListener('click', () => {
        api.disconnectTrainer();
        $('#trainer-status').textContent = 'Not connected';
        $('#hr-status').textContent = '';
        $('#connection-error-text').textContent = '';
        showScreen('connect');
    });

    $('#connect-hr-btn').addEventListener('click', async () => {
        await api.connectHR();
        $('#hr-status').textContent = `Connected: ${api.ftms.hrmDevice.name}`;
    });

    $('#import-workout-input').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        const importStatusEl = $('#import-status');
        importStatusEl.textContent = 'Importing...';
        importStatusEl.style.color = 'var(--text-muted)';

        reader.onload = async (e) => {
            try {
                const workout = JSON.parse(e.target.result);
                const result = await api.createWorkout(workout);

                if (result.success) {
                    importStatusEl.textContent = 'Import successful!';
                    importStatusEl.style.color = 'var(--accent-color)';
                    renderWorkoutList(); // Refresh the list
                } else {
                    const errorMsg = result.errors.join(', ');
                    importStatusEl.textContent = `Error: ${errorMsg}`;
                    importStatusEl.style.color = 'var(--error-color, #ef4444)';
                }
            } catch (err) {
                importStatusEl.textContent = 'Error: Invalid JSON file.';
                importStatusEl.style.color = 'var(--error-color, #ef4444)';
                console.error('Failed to parse workout JSON:', err);
            } finally {
                // Clear the file input to allow re-importing the same file
                event.target.value = '';
                // Clear the status message after a few seconds
                setTimeout(() => { importStatusEl.textContent = ''; }, 5000);
            }
        };

        reader.onerror = () => {
            importStatusEl.textContent = 'Error reading file.';
            importStatusEl.style.color = 'var(--error-color, #ef4444)';
            event.target.value = '';
        };

        reader.readAsText(file);
    });

    // Workout Selection Logic
    function renderWorkoutList() {
        const today = api.getTodaysWorkout();
        const library = api.getWorkouts();
        
        const todayCard = $('#todays-workout-card');
        if (today) {
            $('#todays-workout-details').innerHTML = renderCard(today, true);
            todayCard.style.display = 'block';
        } else {
            todayCard.style.display = 'none';
        }

        const libraryEl = $('#workout-library');
        if (library.length > 0) {
            libraryEl.innerHTML = library.map(w => renderCard(w, false)).join('');
        } else {
            libraryEl.innerHTML = '<p>No workouts in library.</p>';
        }

        document.querySelectorAll('.start-workout-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const workoutId = btn.dataset.id;
                api.startWorkout(workoutId);
            });
        });
    }

    function renderCard(w, isToday) {
        const duration = formatTime(api.workoutManager.getTotalDuration(w));
        return `
            <div class="workout-card glass-panel">
                <h3>${w.name} ${w.agent ? `<span class="agent-badge">${w.agent}</span>` : ''}</h3>
                <p>${w.description || ''}</p>
                <div class="meta">
                    <span>${duration} | FTP: ${w.ftp}W</span>
                    <button class="button start-workout-btn" data-id="${w.id}">${isToday ? 'Load & Start' : 'Start'}</button>
                </div>
            </div>`;
    }

    function updateRollerDeck(currentIndex) {
        if (!api.state.activeWorkout) return;
        
        const intervals = api.state.activeWorkout.intervals;
        const ftp = api.state.activeWorkout.ftp;
        const roller = $('#interval-roller');
        
        // Initialize rollerdeck if empty
        if (roller.children.length === 0) {
            intervals.forEach((iv, idx) => {
                const targetPower = Math.round(ftp * iv.percentage / 100);
                let name = iv.name;
                if (!name) {
                    const zone = PowerZones.getZone(targetPower, ftp);
                    name = zone <= 1 ? 'Warmup' : zone === 2 ? 'Interval' : zone >= 3 ? 'Hard' : 'Unknown';
                }
                
                const el = document.createElement('div');
                el.className = 'roller-item';
                el.id = `roller-item-${idx}`;
                
                el.innerHTML = `
                    <div class="roller-name">${name} - ${targetPower} W</div>
                    <div class="roller-time" id="time-display-${idx}">${formatTime(iv.duration)}</div>
                `;
                
                roller.appendChild(el);
            });
        }
        
        // Update classes based on current index to create rolling effect
        intervals.forEach((_, idx) => {
            const el = document.getElementById(`roller-item-${idx}`);
            if (!el) return;
            
            el.className = 'roller-item'; // Reset classes
            
            if (idx === currentIndex) {
                el.classList.add('current');
            } else if (idx === currentIndex - 1) {
                el.classList.add('prev');
            } else if (idx === currentIndex + 1) {
                el.classList.add('next');
            }
        });
    }
    function renderDiagram(workout) {
        const bar = $('.diagram-bar');
        const totalDuration = api.workoutManager.getTotalDuration(workout);
        bar.innerHTML = workout.intervals.map((iv, index) => {
            const percentage = (iv.duration / totalDuration) * 100;
            const powerPercent = iv.percentage;
            const zone = PowerZones.getZone(workout.ftp * (powerPercent / 100), workout.ftp);
            const color = PowerZones.getZoneColor(zone);
            // Use height to represent power level
            const height = Math.min(100, iv.percentage * 0.8);
            
            // Generate label based on name or fallback to generic zone name
            let label = iv.name;
            if (!label) {
                label = zone <= 1 ? 'Warmup' : zone === 2 ? 'Interval' : zone >= 3 ? 'Hard' : '';
            }

            return `
                <div class="diagram-segment" style="width: ${percentage}%; height: ${height}%; background-color: ${color}; color: ${color};" data-index="${index}">
                    <span class="segment-label">Z${zone} (${label})</span>
                </div>`;
        }).join('');
        // Restore the cursor that was overwritten by innerHTML
        bar.insertAdjacentHTML('beforeend', '<div class="diagram-cursor"></div>');
    }

    function updateDiagram(progressPercentage) {
        const segments = document.querySelectorAll('.diagram-segment');
        let cumulativePercentage = 0;
        segments.forEach(segment => {
            const segmentWidth = parseFloat(segment.style.width);
            // Only mark as completed if the progress has fully passed the segment
            if (cumulativePercentage + segmentWidth <= progressPercentage + 0.1) { // 0.1 for float tolerance
                segment.classList.add('completed');
            } else {
                segment.classList.remove('completed');
            }
            cumulativePercentage += segmentWidth;
        });
    }

    // Summary Screen Logic
    $('#done-btn').addEventListener('click', () => {
        showScreen('selection');
        renderWorkoutList();
    });

    $('#exit-workout-btn').addEventListener('click', () => {
        if (api.state.activeWorkout) {
            $('#exit-modal').style.display = 'flex';
        }
    });

    $('#exit-continue-btn').addEventListener('click', () => {
        $('#exit-modal').style.display = 'none';
    });

    $('#exit-save-btn').addEventListener('click', () => {
        $('#exit-modal').style.display = 'none';
        api.stopWorkout();
    });

    $('#exit-discard-btn').addEventListener('click', () => {
        $('#exit-modal').style.display = 'none';
        api.discardWorkout();
    });

    $('#upload-strava-btn').addEventListener('click', async () => {
        const confirmed = window.confirm("Are you sure you want to upload this workout to Strava?");
        if (!confirmed) {
            return;
        }

        const btn = $('#upload-strava-btn');
        if (!api.isStravaConnected()) {
            // Replace with your Strava Client ID
            const success = await api.connectStrava('YOUR_STRAVA_CLIENT_ID');
            if (!success) {
                btn.textContent = 'Auth Failed';
                return;
            }
        }
        btn.textContent = 'Uploading...';
        const result = await api.uploadToStrava();
        btn.textContent = result.success ? 'Upload Complete!' : 'Upload Failed';
    });

    // API Event Handlers
    api.on('autopause', () => {
        $('#autopause-modal').style.display = 'flex';
    });

    api.on('autoresume', () => {
        $('#autopause-modal').style.display = 'none';
    });

    api.on('connectionfailed', (data) => {
        const { device, error } = data;
        const message = getErrorMessage(error);
        if (device === 'trainer') {
            $('#connection-error-text').textContent = message;
            $('#trainer-status').textContent = 'Connection Failed';
        } else if (device === 'hr') {
            $('#hr-status').textContent = `HR Connection Failed: ${error.name}`;
        }
    });

    api.on('metrics', (m) => {
        const pwr = $('#power-value');
        if (pwr) pwr.textContent = m.power >= 10 ? m.power : '--';
        
        const cad = $('#cadence-value');
        if (cad) cad.textContent = m.cadence > 0 ? m.cadence : '--';
        
        const hr = $('#hr-value');
        if (hr) hr.textContent = m.hr > 0 ? m.hr : '--';
    });

    api.on('workoutstart', (w) => {
        $('#interval-roller').innerHTML = ''; // Clear rollerdeck on start
        renderDiagram(w);
        showScreen('workout');
    });

    api.on('intervalchange', (data) => {
        updateRollerDeck(data.index);
    });
    
    api.on('workoutstop', (summary) => {
        $('#summary-duration').textContent = formatTime(summary.duration);
        $('#summary-avg-power').textContent = summary.avgPower;
        $('#summary-max-power').textContent = summary.maxPower;
        $('#summary-avg-hr').textContent = summary.avgHR;
        $('#summary-tss').textContent = summary.tss;
        $('#summary-kj').textContent = summary.kj;
        showScreen('summary');
    });

    api.on('workoutdiscard', () => {
        showScreen('selection');
        renderWorkoutList();
    });

    api.on('workoutsUpdated', () => {
        if(screens.selection.classList.contains('active')) {
            renderWorkoutList();
        }
    });

    // Timer for workout progress
    setInterval(() => {
        if (api.state.activeWorkout) {
            const progress = api.getWorkoutProgress();
            if (!progress) return;
            
            const progressPercentage = progress.percentage;
            
            // Move cursor
            const bar = $('.diagram-bar');
            if (bar) {
                const barWidth = bar.offsetWidth;
                const cursor = $('.diagram-cursor');
                if (cursor) {
                    cursor.style.transform = `translateX(${progressPercentage / 100 * barWidth}px)`;
                }
            }

            // Update time display in the current rollerdeck item
            if (progress.currentInterval) {
                const currentIdx = progress.intervalIndex;
                const timeEl = document.getElementById(`time-display-${currentIdx}`);
                if (timeEl) {
                    timeEl.textContent = `${formatTime(progress.timeInInterval)} / ${formatTime(progress.currentInterval.duration)}`;
                }
            }

            // Update completed segments
            updateDiagram(progressPercentage);
            
            // Highlight active segment
            const segments = document.querySelectorAll('.diagram-segment');
            segments.forEach((s, idx) => {
                if (idx === progress.intervalIndex) {
                    s.classList.add('active');
                } else {
                    s.classList.remove('active');
                }
            });

            // Update top progress bar
            const progressFill = $('#total-progress-fill');
            if (progressFill) progressFill.style.width = `${progressPercentage}%`;
            
            const timeSpentEl = $('#time-spent-display');
            if (timeSpentEl) timeSpentEl.textContent = formatTime(progress.elapsed);
            
            const timeRemEl = $('#time-remaining-display');
            if (timeRemEl) {
                const timeRemaining = progress.total - progress.elapsed;
                timeRemEl.textContent = `-${formatTime(timeRemaining)}`;
            }
        }
    }, 500);

    // Initial setup
    api.tryReconnect().then(connected => {
        if (connected) {
            $('#trainer-status').textContent = `Connected: ${api.ftms.device.name}`;
            $('#trainer-name-display').textContent = api.ftms.device.name;
            $('#connect-hr-btn').style.display = 'block';
            showScreen('selection');
            renderWorkoutList();
        } else {
            showScreen('connect');
        }
    });
});
