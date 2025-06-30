const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const tesseract = require('node-tesseract-ocr');
const axios = require('axios');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

const baseUrl = 'https://result.rgpv.ac.in/Result/BErslt.aspx';

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/scrape', async (req, res) => {
  const roll = req.body.roll;

  let resultData = {};
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 0 });

    await page.type('input[name="ctl00$ContentPlaceHolder1$txtenroll"]', roll);
    await page.select('select[name="ctl00$ContentPlaceHolder1$ddlSemester"]', '3');

    const captchaSrc = await page.$eval('#ctl00_ContentPlaceHolder1_pnlCaptcha img', img => img.getAttribute('src'));
    const captchaUrl = `https://result.rgpv.ac.in/Result/${captchaSrc}`;

    const captchaImg = await axios.get(captchaUrl, { responseType: 'arraybuffer' });
    fs.writeFileSync(`captcha_${roll}.jpg`, captchaImg.data);

    const captchaText = await tesseract.recognize(`captcha_${roll}.jpg`, {
      lang: 'eng',
      oem: 1,
      psm: 7,
    });

    const cleanCaptcha = captchaText.replace(/[^a-zA-Z0-9]/g, '').trim();
    await page.type('input[name="ctl00$ContentPlaceHolder1$txtCaptcha"]', cleanCaptcha);

    await Promise.all([
      page.click('input[name="ctl00$ContentPlaceHolder1$btnview"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 0 }),
    ]);

    const resultExists = await page.$('#ctl00_ContentPlaceHolder1_pnlGrading') !== null;
    if (!resultExists) {
      await browser.close();
      return res.render('result', { error: 'Invalid CAPTCHA or no result found.', data: null });
    }

    const name = await page.$eval('#ctl00_ContentPlaceHolder1_lblNameGrading', el => el.innerText);
    const sgpa = await page.$eval('#ctl00_ContentPlaceHolder1_lblSGPA', el => el.innerText);
    const cgpa = await page.$eval('#ctl00_ContentPlaceHolder1_lblCGPA', el => el.innerText);

    resultData = { roll, name, sgpa, cgpa };

    await browser.close();

    fs.writeFileSync(`result_${roll}.json`, JSON.stringify(resultData, null, 2));

    res.render('result', { error: null, data: resultData });

  } catch (err) {
    console.error(err);
    res.render('result', { error: err.message, data: null });
  }
});

app.get('/download/:roll', (req, res) => {
  const filePath = `result_${req.params.roll}.json`;
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.send('File not found!');
  }
});

app.listen(3000, () => {
  console.log('✅ Server running on http://localhost:3000');
});
