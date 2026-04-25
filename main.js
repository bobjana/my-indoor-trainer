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
        Object.values(screens).forEach(s => s.classList.remove('active'));
        if (screens[name]) {
            screens[name].classList.add('active');
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
            <div class="workout-card">
                <h3>${w.name} ${w.agent ? `<span class="agent-badge">${w.agent}</span>` : ''}</h3>
                <p>${w.description || ''}</p>
                <div>
                    <span>${duration}</span> | <span>FTP: ${w.ftp}W</span>
                    <button class="button start-workout-btn" data-id="${w.id}" style="float: right;">${isToday ? 'Load & Start' : 'Start'}</button>
                </div>
            </div>`;
    }

    // Workout Screen Logic
    function renderDiagram(workout) {
        const bar = $('.diagram-bar');
        const totalDuration = api.workoutManager.getTotalDuration(workout);
        bar.innerHTML = workout.intervals.map(iv => {
            const percentage = (iv.duration / totalDuration) * 100;
            const powerPercent = iv.percentage;
            const zone = PowerZones.getZone(workout.ftp * (powerPercent / 100), workout.ftp);
            const color = PowerZones.getZoneColor(zone);
            // Use height to represent power level
            const height = Math.min(100, iv.percentage * 0.85);
            return `<div class="diagram-segment" style="width: ${percentage}%; height: ${height}%; background-color: ${color};"></div>`;
        }).join('');
    }

    function updateDiagram(progressPercentage) {
        const segments = document.querySelectorAll('.diagram-segment');
        let cumulativePercentage = 0;
        segments.forEach(segment => {
            const segmentWidth = parseFloat(segment.style.width);
            if (cumulativePercentage + (segmentWidth / 2) < progressPercentage) {
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
            const confirmed = window.confirm("Are you sure you want to stop the current workout?");
            if (confirmed) {
                api.stopWorkout();
            }
        }
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
        $('#power-value').textContent = m.power >= 10 ? m.power : '--';
        $('#cadence-value').textContent = m.cadence > 0 ? m.cadence : '--';
        $('#hr-value').childNodes[0].nodeValue = m.hr > 0 ? `${m.hr} ` : '-- ';
    });

    api.on('workoutstart', (w) => {
        renderDiagram(w);
        showScreen('workout');
    });

    api.on('intervalchange', (data) => {
        const { interval, targetPower } = data;
        $('#interval-name').textContent = `${interval.name} - ${targetPower} W`;
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

    api.on('workoutsUpdated', () => {
        if(screens.selection.classList.contains('active')) {
            renderWorkoutList();
        }
    });

    // Timer for workout progress
    setInterval(() => {
        if (api.state.activeWorkout) {
            const progress = api.getWorkoutProgress();
            const progressPercentage = progress.percentage;
            
            // Move cursor
            $('.diagram-cursor').style.transform = `translateX(${progressPercentage / 100 * $('.diagram-bar').offsetWidth}px)`;

            // Update time display
            $('#interval-time').textContent = `${formatTime(progress.timeInInterval)} / ${formatTime(progress.currentInterval.duration)}`;

            // Update completed segments
            updateDiagram(progressPercentage);

            // Update top progress bar
            $('#total-progress-fill').style.width = `${progressPercentage}%`;
            $('#time-spent-display').textContent = formatTime(progress.elapsed);
            const timeRemaining = progress.total - progress.elapsed;
            $('#time-remaining-display').textContent = `-${formatTime(timeRemaining)}`;
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
