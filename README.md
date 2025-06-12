# Google Ads Negative Keyword Script

This repository contains a single Google Ads Script (`negatif.js`) that automatically analyzes search terms and adds inefficient keywords to a shared negative keyword list. It aggregates performance data over the last 60 days, classifies terms by risk level and updates the list accordingly. A detailed HTML report is emailed at the end of the run.

## Usage
1. Open your Google Ads account and navigate to **Tools & Settings > Bulk Actions > Scripts**.
2. Create a new script and paste the contents of `negatif.js`.
3. Review the configuration constants at the top of the `main` function and adjust if necessary.
4. Authorize and run the script, or schedule it to run periodically.

The script is case-sensitive; the terms "iphone" and "iPhone" are treated as different queries. It now looks at both exact matches and their close variants. A shared negative keyword list named `Script Liste` is created or replaced each run.

## License
This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
