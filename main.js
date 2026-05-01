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
    let workoutCompletedNaturally = false;

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
        const svgProfile = generateWorkoutSVG(w);
        return `
            <div class="workout-card glass-panel">
                <h3>${w.name} ${w.agent ? `<span class="agent-badge">${w.agent}</span>` : ''}</h3>
                <p>${w.description || ''}</p>
                <div class="workout-profile-svg">${svgProfile}</div>
                <div class="meta">
                    <span>${duration} | FTP: ${w.ftp}W</span>
                    <button class="button start-workout-btn" data-id="${w.id}">${isToday ? 'Load & Start' : 'Start'}</button>
                </div>
            </div>`;
    }

    function generateWorkoutSVG(workout) {
        if (!workout || !workout.intervals || workout.intervals.length === 0) return '';
        const totalDuration = api.workoutManager.getTotalDuration(workout);
        if (totalDuration === 0) return '';
        
        let svg = '<svg viewBox="0 0 100 40" preserveAspectRatio="none" style="width: 100%; height: 60px; margin-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.1);">';
        let currentX = 0;
        
        workout.intervals.forEach(iv => {
            const width = (iv.duration / totalDuration) * 100;
            const height = Math.min((iv.percentage / 150) * 40, 40);
            const y = 40 - height;
            const zone = PowerZones.getZone(workout.ftp * (iv.percentage / 100), workout.ftp);
            const color = PowerZones.getZoneColor(zone);
            
            svg += `<rect x="${currentX}" y="${y}" width="${width}" height="${height}" fill="${color}" opacity="0.8" />`;
            currentX += width;
        });
        
        svg += '</svg>';
        return svg;
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
        const btn = $('#upload-strava-btn');
        if (!api.isStravaConnected()) {
            const success = await api.connectStrava();
            if (!success) {
                btn.textContent = 'Auth Failed';
                setTimeout(() => { btn.textContent = 'Upload to Strava'; }, 3000);
                return;
            }
        }
        btn.textContent = 'Uploading...';
        const result = await api.uploadToStrava();
        
        if (result.success) {
            btn.textContent = 'Upload Complete!';
            btn.disabled = true;
            btn.style.backgroundColor = '#4CAF50';
            btn.style.borderColor = '#4CAF50';
        } else {
            btn.textContent = 'Upload Failed';
            setTimeout(() => { btn.textContent = 'Upload to Strava'; }, 3000);
            alert(`Strava Upload failed: ${result.error}`);
        }
    });

    $('#download-screenshot-btn').addEventListener('click', () => {
        const summary = api.workoutManager.getLastWorkoutSummary();
        const workout = api.state.activeWorkout || (summary ? api.workoutManager.getWorkout(summary.id) : null) || summary;
        if (!workout) return;
        
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 630;
        const ctx = canvas.getContext('2d');
        
        // Background
        ctx.fillStyle = '#0f1218';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 60px "Outfit", sans-serif';
        ctx.fillText(workout.name || 'Indoor Trainer Workout', 60, 100);
        
        // Subtitle stats
        if (summary) {
            ctx.font = '30px "Outfit", sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(`${formatTime(summary.duration)} • ${summary.tss} TSS • ${summary.avgPower} W Avg`, 60, 160);
        }

        // Draw intervals (TrainerRoad style)
        const startX = 60;
        const endX = 1140;
        const width = endX - startX;
        const startY = 550;
        const maxHeight = 300;

        const totalDuration = summary ? summary.duration : api.workoutManager.getTotalDuration(workout);
        const ftp = workout.ftp || 200;

        if (workout.intervals && workout.intervals.length > 0 && totalDuration > 0) {
            let currentX = startX;
            
            // Draw planned blocks in solid blue
            workout.intervals.forEach((iv) => {
                const wRatio = iv.duration / api.workoutManager.getTotalDuration(workout);
                const segWidth = width * wRatio;
                const pRatio = Math.min(iv.percentage, 150) / 150;
                const segHeight = maxHeight * pRatio;
                
                // TrainerRoad classic blue blocks
                ctx.fillStyle = 'rgba(0, 168, 255, 0.5)';
                ctx.strokeStyle = '#00a8ff';
                ctx.lineWidth = 2;
                
                ctx.fillRect(currentX, startY - segHeight, Math.ceil(segWidth), segHeight);
                ctx.strokeRect(currentX, startY - segHeight, Math.ceil(segWidth), segHeight);
                
                currentX += segWidth;
            });
        }
        
        // Draw baseline
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, startY);
        ctx.stroke();
        
        // Draw Legend
        ctx.font = '20px "Outfit", sans-serif';
        ctx.fillStyle = '#00a8ff';
        ctx.fillText('■ Planned Power', 60, 590);
        ctx.fillStyle = '#ffd700';
        ctx.fillText('— Actual Power', 250, 590);
        ctx.fillStyle = 'rgba(255, 59, 59, 0.9)';
        ctx.fillText('— Heart Rate', 430, 590);

        // Draw actual power line overlay in bright yellow
        const history = api.state.metricsHistory;
        if (history && history.length > 0 && totalDuration > 0) {
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            
            history.forEach((m, i) => {
                const px = startX + (width * (m.elapsed / totalDuration));
                // Target power = 100% FTP = 100/150 * maxHeight
                const powerPercent = (m.power / ftp) * 100;
                const pRatio = Math.min(powerPercent, 150) / 150;
                const py = startY - (maxHeight * pRatio);
                
                if (i === 0) {
                    ctx.moveTo(px, py);
                } else {
                    ctx.lineTo(px, py);
                }
            });
            ctx.stroke();
            
            // Draw HR line overlay in red (optional, scaled against max HR)
            ctx.strokeStyle = 'rgba(255, 59, 59, 0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            let hrStarted = false;
            history.forEach((m, i) => {
                if (!m.heartRate) return;
                const px = startX + (width * (m.elapsed / totalDuration));
                // Scale HR relative to standard 200 max
                const hRatio = Math.min(m.hr, 200) / 200;
                // Place it using slightly different scale so it doesnt overlap perfectly with power
                const py = startY - (maxHeight * 1.2 * hRatio);
                
                if (!hrStarted) {
                    ctx.moveTo(px, py);
                    hrStarted = true;
                } else {
                    ctx.lineTo(px, py);
                }
            });
            ctx.stroke();
        }
        
        // Trigger Download
        const link = document.createElement('a');
        link.download = `workout-${workout.name ? workout.name.replace(/\s+/g, '-').toLowerCase() : 'summary'}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
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
        workoutCompletedNaturally = false;
        $('#interval-roller').innerHTML = ''; // Clear rollerdeck on start
        renderDiagram(w);
        showScreen('workout');
    });

    api.on('workoutcomplete', () => {
        workoutCompletedNaturally = true;
    });

    api.on('intervalchange', (data) => {
        updateRollerDeck(data.index);
    });
    
    api.on('workoutstop', async (summary) => {
        $('#summary-duration').textContent = formatTime(summary.duration);
        $('#summary-avg-power').textContent = summary.avgPower;
        $('#summary-max-power').textContent = summary.maxPower;
        $('#summary-avg-hr').textContent = summary.avgHR;
        $('#summary-tss').textContent = summary.tss;
        $('#summary-kj').textContent = summary.kj;

        const stravaBtn = $('#upload-strava-btn');
        if (workoutCompletedNaturally && api.isStravaConnected()) {
            // Auto-upload to Strava — hide button, upload silently
            stravaBtn.style.display = 'none';
            const result = await api.uploadToStrava();
            if (!result.success) {
                // Upload failed — show the button so user can retry
                stravaBtn.style.display = '';
            }
        } else {
            // Show the upload button as normal
            stravaBtn.style.display = '';
            stravaBtn.textContent = 'Upload to Strava';
            stravaBtn.disabled = false;
            stravaBtn.style.backgroundColor = '';
            stravaBtn.style.borderColor = '';
        }

        // Dismiss any modals that might be overlaying
        $('#autopause-modal').style.display = 'none';
        $('#exit-modal').style.display = 'none';
        showScreen('summary');
    });

    api.on('workoutdiscard', () => {
        workoutCompletedNaturally = false;
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
