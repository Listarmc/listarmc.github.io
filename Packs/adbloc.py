import os

# Define the directory containing the HTML files
directory = '/home/hamza/Packs'

# JavaScript to insert
javascript_code = """
<script>
document.addEventListener("DOMContentLoaded", function () {
    // Create a script element to load the ad script
    var script = document.createElement('script');
    script.src = "//dcbbwymp1bhlf.cloudfront.net/?wbbcd=1084188";
    script.async = true;

    script.onload = function() {
        // Script loaded successfully, do nothing
    };

    script.onerror = function() {
        // Script failed to load, likely due to ad blocker
        document.getElementById('adblock-message').style.display = 'block';
    };

    document.head.appendChild(script);
});
</script>
"""

# HTML to insert
html_code = """
<div id="adblock-message" style="display:none;">
    <div class="adblock-container">
        <h2>Ad Blocker Detected</h2>
        <p>Please disable your ad blocker to access this website.</p>
        <img src="https://i.imgur.com/YrDk7NT.png" alt="Ad Block Warning" class="adblock-image">
        <button onclick="location.reload();" class="refresh-button">Refresh Page</button>
    </div>
</div>
"""

# Function to insert the code into each HTML file
def insert_code_in_html(file_path):
    with open(file_path, 'r') as file:
        content = file.read()

    # Check if </body> exists
    if '</body>' in content:
        # Insert JavaScript and HTML code before the closing </body> tag
        new_content = content.replace('</body>', f'{javascript_code}\n{html_code}\n</body>')

        # Write the new content back to the file
        with open(file_path, 'w') as file:
            file.write(new_content)
        print(f"Code added to {file_path}")
    else:
        print(f"No </body> tag found in {file_path}")

# Iterate through all files in the directory
for filename in os.listdir(directory):
    if filename.endswith('.html'):
        file_path = os.path.join(directory, filename)
        insert_code_in_html(file_path)

print("Code insertion completed.")
