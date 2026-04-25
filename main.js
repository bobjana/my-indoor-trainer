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
            showScreen('selection');
            renderWorkoutList();
        } else {
            $('#trainer-status').textContent = 'Stub Connection Failed';
        }
    });

    $('#connect-hr-btn').addEventListener('click', async () => {
        await api.connectHR();
        $('#hr-status').textContent = `Connected: ${api.ftms.hrmDevice.name}`;
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
            return `<div class="diagram-segment" style="width: ${percentage}%; background-color: ${color};"></div>`;
        }).join('');
    }

    // Summary Screen Logic
    $('#done-btn').addEventListener('click', () => {
        showScreen('selection');
        renderWorkoutList();
    });

    $('#stop-workout-btn').addEventListener('click', () => {
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
        $('#power-value').textContent = m.power;
        $('#cadence-value').textContent = m.cadence;
        $('#hr-value').childNodes[0].nodeValue = m.hr + ' ';
        const hrZone = HRZones.getZone(m.hr);
        $('.hr-zone-badge').style.backgroundColor = HRZones.getZoneColor(hrZone);
    });

    api.on('workoutstart', (w) => {
        renderDiagram(w);
        showScreen('workout');
    });

    api.on('intervalchange', (data) => {
        const { interval, targetPower } = data;
        $('#target-power-value').textContent = targetPower;
        $('#interval-name').textContent = interval.name;
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
            $('.diagram-cursor').style.transform = `translateX(${progress.percentage / 100 * $('.diagram-bar').offsetWidth}px)`;

            const intervalTimeRemaining = progress.currentInterval.duration - progress.timeInInterval;
            $('#interval-time').textContent = `${formatTime(progress.timeInInterval)} / ${formatTime(progress.currentInterval.duration)}`;
        }
    }, 500);

    // Initial setup
    api.tryReconnect().then(connected => {
        if (connected) {
            $('#trainer-status').textContent = `Connected: ${api.ftms.device.name}`;
            $('#connect-hr-btn').style.display = 'block';
            showScreen('selection');
            renderWorkoutList();
        } else {
            showScreen('connect');
        }
    });
});
