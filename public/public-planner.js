let currentRef = null;

document.getElementById('publicPlannerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
        type: document.getElementById('guestDocType').value,
        className: document.getElementById('guestClass').value,
        subject: document.getElementById('guestSubject').value,
        topic: document.getElementById('guestTopic').value
    };

    const res = await fetch('/api/public/generate-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (result.success) {
        document.getElementById('previewCard').style.display = 'block';
        document.getElementById('previewContent').innerHTML = `
            <p><strong>Topic:</strong> ${result.preview.topic}</p>
            <p><strong>NCDC Competency:</strong> ${result.preview.competences}</p>
            <p><strong>Activity of Integration:</strong> ${result.preview.activityOfIntegration}</p>
            <p><em>...Unlock to view complete 80-minute procedure, resources, teacher/student activities, and printable PDF.</em></p>
        `;
    }
});

async function payAndUnlock() {
    const network = document.getElementById('payNetwork').value;
    const phone = document.getElementById('payPhone').value;

    if (!phone) {
        alert('Please enter your phone number.');
        return;
    }

    const res = await fetch('/api/public/initiate-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            phoneNumber: phone,
            network: network,
            docType: document.getElementById('guestDocType').value
        })
    });

    const data = await res.json();
    if (data.success) {
        alert(data.message);
        // Start polling for payment verification...
    }
}