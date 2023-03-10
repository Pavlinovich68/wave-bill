const remote = require('electron').remote;
const bootstrap = require('bootstrap');
const fs = require('fs');
const QRCode = require('qrcode');
const domtoimage = require('dom-to-image');
const wnd = remote.getCurrentWindow();
const { PDFDocument } = require('pdf-lib');

const pdfCreator = (function(){
    async function printSinglePage(page){
        return await domtoimage.toPng(page)
            .then(async (data) => {
                if (data)
                    return data
                else
                    return null;
            }).catch((error)=>{
                bills.setError(error.message);
            });
    }
    async function create(){
        let area = document.querySelector('.pages-area');
        let pages = area.querySelectorAll('.bill-item');
        if (pages.length === 0)
            return;
        let addr = area.getAttribute('data-house-addr');

        if (!fs.existsSync(`${bills.getPrefs().output}\\${addr}`)){
            fs.mkdirSync(`${bills.getPrefs().output}\\${addr}`);
        }

        let idx = 1;
        let base64Data = null;
        for (const page of pages) {
            let imageName = `${bills.getPrefs().output}\\${addr}\\${idx}.png`;
            let item = await printSinglePage(page);
            base64Data = item.replace(/^data:image\/png;base64,/, "");
            await fs.writeFile(imageName, base64Data, 'base64');
            idx++;
        }
        return true;
    }
    async function createPDF(addr){
        let path = `${bills.getPrefs().output}\\${addr}`;
        let dirExists = fs.existsSync(path);
        if (!dirExists)
            return false;
        let filenames = fs.readdirSync(path);

        const doc = await PDFDocument.create();

        for (let i = 0; i < filenames.length; i++){
            const page = doc.addPage();
            let img = fs.readFileSync(`${path}\\${filenames[i]}`);
            img = await doc.embedPng(img);
            let pageWidth = page.getWidth();
            let factor = pageWidth / 1050;
            page.drawImage(img, {
                x: 0,
                y: page.getHeight() - (img.height * factor),
                width: img.width * factor,
                height: img.height * factor
            });
        }

        fs.writeFileSync(`${path}.pdf`, await doc.save());
        return true;
    }
    return Object.freeze({create, createPDF} );
})();
const bills =(function(){
    const dataDir = './data';
    const months = {
        1: '????????????',
        2: '??????????????',
        3: '????????',
        4: '????????????',
        5: '??????',
        6: '????????',
        7: '????????',
        8: '????????????',
        9: '????????????????',
        10: '??????????????',
        11: '????????????',
        12: '??????????????'
    }
    const preparedData = {
        houseDict: {},
        serviceDict: {},
        errors: [],
        preferences: {
            beginDate: null,
            endDate: null,
            organization: null
        }
    }
    let storedPref = {
        output: null,
        executor: {
            name: null,
            address: null,
            phones: null,
            site: null,
            email: null,
            work_time: null,
            gis_id: null,
            inn: null,
            bank: null,
            calc_acc: null,
            corr_acc: null,
            bik: null
        },
        recipient: {
            name: null,
            bank: null,
            inn: null,
            calc_acc: null,
            corr_acc: null,
            bik: null,
            kpp: null
        }
    }

    function parseDate(date){
        let parts = date.split('-');
        return {
            year: parseInt(parts[0]),
            month: parseInt(parts[1]),
            day: parseInt(parts[2])
        };
    }
    function dateToString(date){
        return `${date.day.toString().padStart(2, '0')}.${date.month.toString().padStart(2, '0')}.${date.year}`;
    }
    function buildHouseDict(data){
        preparedData.houseDict = {};
        preparedData.serviceDict = data.ServiceObjects;
        preparedData.errors = data.Errors;
        preparedData.preferences = {
            beginDate: parseDate(data.BeginDate),
            endDate: parseDate(data.EndDate),
            organization: data.OrganizationId
        };

        for (const [key, value] of Object.entries(data.Accounts)) {
            if (!value.IsAccountClosed && !value.IsHouseClosed) {
                let accounts = {};
                value.printed = false;
                accounts[key] = value;
                let house = preparedData.houseDict[value.HouseInfoId];
                if (!house) {
                    preparedData.houseDict[value.HouseInfoId] = {
                        address: value.AddressName,
                        data: accounts,
                        printed: false
                    }
                } else {
                    house.data[key] = value;
                }
            }
        }
        rewriteData();
        load();
    }
    function rewriteData(){
        let json = JSON.stringify(preparedData);
        if (!fs.existsSync(dataDir)){
            fs.mkdirSync(dataDir);
        }

        if (fs.existsSync(`${dataDir}/account.data`)){
            fs.unlinkSync(`${dataDir}/account.data`);
        }

        fs.writeFileSync(`${dataDir}/account.data`, json);
        return true;
    }
    function readBills(name){
        let obj = JSON.parse(fs.readFileSync(name, 'utf8'));
        buildHouseDict(obj);
    }
    // ???????????????????? ?? ?????????? ???????????????? ?? ?????????????? ??????????
    function load(){
        if (fs.existsSync(`./pref/pref.json`)){
            storedPref = JSON.parse(fs.readFileSync(`./pref/pref.json`, 'utf8'));
            let inputs = document.querySelectorAll('.stored-pref');
            inputs.forEach((item)=>{
                let attr = item.getAttribute('data-field-name');
                let words = attr.split('.');
                if (words.length === 1){
                    item.value = storedPref[words[0]];
                } else {
                    item.value = storedPref[words[0]][words[1]];
                }
            });
        }
        let title = document.getElementById('app-title');
        title.innerText = `${storedPref.executor.name} (???????????? ??????????????????)`;

        if (!fs.existsSync(`${dataDir}/account.data`))
            return;
        let data = JSON.parse(fs.readFileSync(`${dataDir}/account.data`, 'utf8'));

        preparedData.houseDict = data.houseDict;
        preparedData.serviceDict = data.serviceDict;
        preparedData.errors = data.errors;
        preparedData.preferences = data.preferences;

        let houses = Object.entries(data.houseDict);

        document.querySelector('.info-decimal[data-decimal-type="begin-date"]').innerText = dateToString(data.preferences.beginDate);
        document.querySelector('.info-decimal[data-decimal-type="end-date"]').innerText = dateToString(data.preferences.endDate);
        document.querySelector('.info-decimal[data-decimal-type="all-houses"]').innerText = houses.length;

        buildHousesGrid();

        document.getElementById('errorList').innerHTML = '';
        data.errors.forEach((item)=>{
            setError(item)
        })
    }
    function buildHousesGrid(){
        let html = '';
        let houses = Object.entries(preparedData.houseDict);

        let counts = 0;
        for (const [key, value] of houses) {
            counts += Object.keys(value.data).length;
            let be = billsExist(value.address, Object.keys(value.data).length);
            html += `<div class="content-data-row" data-house-id="${key}" data-house-addr="${value.address}">                        
                        <div>${value.address}</div>
                        <div class="acc-count">${Object.keys(value.data).length} ??.??.</div>
                        <button type="button" class="btn btn-secondary tool-button qr-generate"><i class="fa fa-qrcode"></i></button>
                        <button type="button" class="btn btn-secondary tool-button pdf-print" style="${be ? "display:block" : "display:none"}"><i class="fa fa-file-pdf-o"></i></button>
                    </div>`;
        }

        document.querySelector('.info-decimal[data-decimal-type="all-counts"]').innerText = counts;

        let grid = document.getElementById('houseGrid');
        grid.innerHTML = html;

        grid.querySelectorAll("input.form-check-input").forEach((elem) => {
            elem.addEventListener('click', checkHouseItem);
        });
    }
    function billsExist(addr, cnt){
        let dirExists = fs.existsSync(`${storedPref.output}\\${addr}`);
        if (!dirExists)
            return false;
        let filenames = fs.readdirSync(`${storedPref.output}\\${addr}`);
        return cnt === filenames.length;
    }
    function setError(err){
        let area = document.getElementById('errorList');
        area.innerHTML += `<div class="alert alert-danger error-list-item" role="alert">${err}</div>`;
        let cnt = area.querySelectorAll('.error-list-item').length;
        let tab = document.getElementById('errors-tab');
        tab.innerText = `???????????? (${cnt})`;
    }
    function printHouse(id){
        let area = document.querySelector('.pages-area');
        area.innerHTML = '';
        let houseData = preparedData.houseDict[id];
        let result = false;
        for (const [key, value] of Object.entries(houseData.data)){
            result = printBill(value, key);
            if (!result){
                break;
            }
        }

        let qrArr = document.querySelectorAll(`canvas.qr-code`);
        qrArr.forEach((qr)=>{
           let key = qr.getAttribute('data-acc-key');
           let bill = houseData.data[key];
           let val = qrValue(bill);
           QRCode.toCanvas(qr, val);
        });

        let btn = document.getElementById('btnCreateBills');
        if (!result){
            btn.disabled = true;
            return false;
        } else {
            houseData.printed = true;
            btn.disabled = qrArr.length === 0;
            return true;
        }
    }
    function printBill(bill, key){
        let payments = serviseRows(bill);
        let html = `<div class="bill-item" data-house-addr="${bill.AddressName}">
            <div class="payer-info">
                <div class="base-text period-info">
                    <div>???????? ???? ???????????? ?????? ????</div>
                    <div>${period()}</div>
                </div>
            </div>
            <div class="bill-info-grid">
                <div class="bill-all-info">
                    <div class="bill-info-text">
                        <div class="bill-info-text-row">???????????????? ?? ?????????????????????? ??????????</div>
                        <div class="bill-info-text-row bold-row">????????????????????: ${bill.OwnerSurname} ${bill.OwnerName} ${bill.OwnerMiddleName}</div>
                        <div class="bill-info-text-row bold-row">??????????: ${bill.AddressName} ????. ${bill.FlatNumber}</div>
                    </div>
                    <div></div>
                    <div class="bill-info-executor">
                        <div class="bill-info-executor-row">?????????????? ??????????????????: ${bill.TotalArea} ???????????????????? ??????????????????????/??????????????????????????: ${bill.LodgerCount}</div>
                        <div class="bill-info-executor-row">?????????????????????? ??????????: ${storedPref.executor.name}</div>
                        <div class="bill-info-executor-row">??????????: ${storedPref.executor.address}</div>
                        <div class="bill-info-executor-row">???????????????????? ?????????????????? ??????????????????????: ??/?? ${storedPref.executor.calc_acc} ${storedPref.executor.bank}, ??/?? ${storedPref.executor.corr_acc}, ?????? ${storedPref.executor.bik}</div>
                        <div class="bill-info-executor-row">????????: ${storedPref.executor.site}    ????.??????????: ${storedPref.executor.email}</div>
                        <div class="bill-info-executor-row bill-info-executor-wt">
                            <div>?????????? ????????????:</div>
                            <div>${storedPref.executor.work_time}</div>
                            <div>??????????????:</div>
                            <div>${storedPref.executor.phones}</div>
                        </div>
                        <div class="bill-info-executor-row">???????????? ?????????????? ???????? ?????? ??????: ${storedPref.executor.gis_id}</div>
                        <div style="padding: 0 5px 0 5px;">?????????????????????????? ???????????????????? ?????????????????? ?????? ??????: ${bill.GisGkhUniqueServiceNumber}</div>
                    </div>
                </div>                
                <div class="bill-info-qr">
                    <canvas id="qr-${bill.PersonalAccountId}" data-acc-key="${key}" class="qr-code"></canvas>
                </div>
            </div>
            <p class="bill-font-1 bill-step-h1">???????????????????? ?????? ???????????????? ?????????????????????????????? ?????????????? (?????????????????????? ????????????????)</p>
            <div class="header-info">
                <div class="bill-font-2 cell-bottom-border cell-right-border">???????????????????????? ???????????????????? ??????????????</div>
                <div class="bill-font-2 cell-bottom-border cell-right-border">?????????? ?????????????????????? ?????????? ?? ???????????????????? ?????????????????? ?????? ???????????????? ?????????? ???? ???????????????????? ???????????? ?????????????????? ?? ???????????????????????? ??????????</div>
                <div class="bill-font-2 cell-bottom-border">??? ???????????????? ??????????</div>
                <div class="bill-font-3 cell-right-border">${storedPref.recipient.name}</div>
                <div class="bill-font-3 cell-right-border">?????? ${storedPref.recipient.inn} ?????? ${storedPref.recipient.kpp} ??/?? ${storedPref.recipient.calc_acc} ${storedPref.recipient.bank}, ??/?? ${storedPref.recipient.corr_acc}, ?????? ${storedPref.recipient.bik}</div>
                <div class="bill-font-3">${bill.AccountNumber}</div>
            </div>
            <p class="bill-font-1 bill-step-h1">???????????? ?????????????? ?????????? ???? ???????????????????? ?? ???????????? ???????????? ?????????????????? ?? ???????????????????????? ????????????</p>
            <div class="payment-header-table" style="border-bottom-style: none">
                <div class="cell-bottom-border cell-right-border">???????? ??????????</div>
                <div class="cell-bottom-border cell-right-border">??????????</div>
                <div class="cell-bottom-border cell-right-border">??????????</div>
                <div class="cell-bottom-border cell-right-border">??????????????????</div>
                <div class="cell-bottom-border cell-right-border">????????????????????</div>
                <div class="cell-bottom-border">?????????? ?? ????????????</div>
                <div class="cell-bottom-border cell-right-border">1</div>
                <div class="cell-bottom-border cell-right-border">2</div>
                <div class="cell-bottom-border cell-right-border">3</div>
                <div class="cell-bottom-border cell-right-border">4</div>
                <div class="cell-bottom-border cell-right-border">5</div>
                <div class="cell-bottom-border">6</div>
                ${payments[0]}
            </div>
            <div class="payment-footer-table">
                <div></div>
                <div>${payments[1].toFixed(2)}</div>
            </div>
            <p class="total-sum">?????????? ?? ????????????: ${payments[1].toFixed(2)} ??????.</p>
        </div>`;
        let area = document.querySelector('.pages-area');
        area.innerHTML += html;
        area.setAttribute('data-house-addr', bill.AddressName);
        area.setAttribute('data-house-id', bill.HouseInfoId);

        bill.printed = true;
        return true;
    }

    function serviseRows(bill){
        try {
            let result = ['', 0.00];
            if (typeof bill === 'undefined')
                return ['?????? ???????????? ???? ??????????????????????????', 0.00];
            for (const coll of Object.values(bill.SerivceCollections)){
                for (const serv of Object.values(coll.Services)){
                    let service = bills.preparedData.serviceDict[serv.ServiceId];
                    result[0] += `<div class="cell-bottom-border cell-right-border payment-table-name">${service.Name}</div>
                    <div class="cell-bottom-border cell-right-border payment-table-other">${serv.Consumption}</div>
                    <div class="cell-bottom-border cell-right-border payment-table-other">${serv.Price}</div>
                    <div class="cell-bottom-border cell-right-border payment-table-other">${serv.ChargeSum}</div>
                    <div class="cell-bottom-border cell-right-border payment-table-other">${serv.RecalculationSum??0.00}</div>
                    <div class="cell-bottom-border payment-table-other">${serv.ChargeSum + serv.RecalculationSum??0}</div>`;
                    result[1] += serv.ChargeSum + serv.RecalculationSum??0;
                }
            }
            return result;
        } catch (err){
            setError(err.message);
        }
    }

    function qrValue(bill){
        let data = serviseRows(bill);
        let pay = data[1].toFixed(2) *100;
        return `ST00012|
        Name=${storedPref.recipient.name}|
        PersonalAcc=${storedPref.recipient.calc_acc}|
        BankName=${storedPref.recipient.bank}|
        BIC=${storedPref.recipient.bik}|
        CorrespAcc=${storedPref.recipient.corr_acc}|
        PayeeINN=${storedPref.recipient.inn}|
        KPP=${storedPref.recipient.kpp}|
        Sum=${pay}|
        PersAcc=${bill.AccountNumber}|
        LastName=${bill.OwnerSurname}|
        FirstName=${bill.OwnerName}|
        MiddleName=${bill.OwnerMiddleName}|
        PaymPeriod=${preparedData.preferences.beginDate.month}.${preparedData.preferences.beginDate.year}|
        AddAmount=0`;
    }

    function period(){
        return `${months[preparedData.preferences.beginDate.month]} ${preparedData.preferences.beginDate.year} ??.`
    }
    function changeTab(elem){
        let tabs = document.querySelectorAll('.nav-link');
        tabs.forEach((tab)=>{
           if (tab !== elem){
               tab.setAttribute('aria-selected', 'false');
           }
        });
        elem.setAttribute('aria-selected', 'true');
    }

    function getPrefs(){
        return storedPref;
    }

    return Object.freeze({readBills, load, printHouse, changeTab, preparedData, getPrefs, storedPref, setError} );
})();

document.addEventListener('DOMContentLoaded', () => {
    let btnMin = document.querySelector('.btn-min');
    let btnMax = document.querySelector('.btn-max');
    let btnClose = document.querySelector('.btn_close');
    let iconBtnMax = btnMax.children[0];

    let btnDownload = document.getElementById('btnDownload');
    let btnOutputPath = document.getElementById('btnSelectOutputPath');
    let btnSavePref = document.getElementById('btnSavePref');
    let btnCreateBills = document.getElementById('btnCreateBills');

    btnMin.addEventListener('click', ()=>{
       wnd.minimize();
    });

    btnMax.addEventListener('click', ()=>{
       if (!wnd.isMaximized()){
           wnd.maximize();
           iconBtnMax.classList.remove('fa-window-maximize');
           iconBtnMax.classList.add('fa-window-restore');
       } else {
           wnd.unmaximize();
           iconBtnMax.classList.add('fa-window-maximize');
           iconBtnMax.classList.remove('fa-window-restore');
       }
    });

    btnClose.addEventListener('click', ()=>{
       wnd.close();
    });

    btnDownload.addEventListener('click', () => {
        let options = {
            title : "?????????????? ???????? ?? ??????????????????",
            buttonLabel : "??????????????",
            filters :[
                {name: '???????????????? ?????????? ??????????', extensions: ['json']}
            ],
            properties: ['openFile']
        }
        remote.dialog.showOpenDialog( options).then((data)=>{
            document.getElementById('jsonFile').value = data.filePaths[0];
            bills.readBills(data.filePaths[0]);
        });
    });

    btnOutputPath.addEventListener('click', () => {
        let options = {
            title : "?????????????? ???????? ?????? ???????????????????? ??????????????????",
            buttonLabel : "??????????????",
            properties: ['openDirectory']
        }
        remote.dialog.showOpenDialog(options).then((dir)=>{
            document.getElementById('outputPath').value = dir.filePaths[0];
        });
    });

    btnSavePref.addEventListener('click', () => {
        let inputs = document.querySelectorAll('.stored-pref');
        inputs.forEach((item)=>{
            let attr = item.getAttribute('data-field-name');
            let words = attr.split('.');
            if (words.length === 1){
                bills.storedPref[words[0]] = item.value;
            } else {
                bills.storedPref[words[0]][words[1]] = item.value;
            }
        });
        let json = JSON.stringify(bills.storedPref);
        if (!fs.existsSync('./pref')){
            fs.mkdirSync('./pref');
        }
        fs.writeFileSync(`./pref/pref.json`, json);
    });

    btnCreateBills.addEventListener('click', async () => {
        let isOk = await pdfCreator.create();
        if (isOk){
            let area = document.querySelector('.pages-area');
            let houseId = area.getAttribute('data-house-id');
            let row = document.querySelector(`.content-data-row[data-house-id="${houseId}"]`);
            row.querySelector('button.pdf-print').style.display = 'block';
        }
    });

    let tab1 = document.getElementById('house-list-tab');
    tab1.addEventListener('click', () => bills.changeTab(tab1));

    let tab2 = document.getElementById('print-area-tab');
    tab2.addEventListener('click', () => bills.changeTab(tab2));

    const triggerTabList = document.querySelectorAll('#myTab button[data-bs-toggle="tab"]')
    triggerTabList.forEach(triggerEl => {
        const tabTrigger = new bootstrap.Tab(triggerEl)

        triggerEl.addEventListener('click', event => {
            event.preventDefault()
            tabTrigger.show()
        });
        // triggerEl.addEventListener('show.bs.tab', function (event) {
        //     if (event.target === document.getElementById('print-area-tab')){
        //         console.log('!!!');
        //     }
        // });
    })

    bills.load();

    let qrGenerateButtons = document.querySelectorAll('.qr-generate');
    qrGenerateButtons.forEach((btn)=>{
        btn.addEventListener('click', ()=>{
            let id = btn.closest('.content-data-row').getAttribute('data-house-id');
            if (bills.printHouse(id)){
                let triggerEl = document.querySelector('#myTab button[data-bs-target="#printAreaTab"]');
                bootstrap.Tab.getInstance(triggerEl).show();
            }
        });
    });

    let pdfPrintButtons = document.querySelectorAll('.pdf-print');
    pdfPrintButtons.forEach((btn)=>{
        btn.addEventListener('click', ()=>{
            let addr = btn.closest('.content-data-row').getAttribute('data-house-addr');
            pdfCreator.createPDF(addr);
        });
    });
});

window.addEventListener('resize', () => {
    let btnMax = document.querySelector('.btn-max');
    let iconBtnMax = btnMax.children[0];

    if (wnd.isMaximized()){
        wnd.maximize();
        iconBtnMax.classList.remove('fa-window-maximize');
        iconBtnMax.classList.add('fa-window-restore');
    } else {
        wnd.unmaximize();
        iconBtnMax.classList.add('fa-window-maximize');
        iconBtnMax.classList.remove('fa-window-restore');
    }
});